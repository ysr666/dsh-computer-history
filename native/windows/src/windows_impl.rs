//! Everything Windows-specific: the foreground window's identity, its window metadata, and UI Automation.
//!
//! Boundary, deliberately: identity is the window's process (pid, image name) and AppUserModelID;
//! metadata is the window title, the focused element's control type and its password flag. No text, no
//! document body, no selection and no value pattern is ever read in this module.
//!
//! Ordering: the engine calls `foreground()` before any policy decision and `describe()` only after the
//! gate passed, mirroring the macOS collector. Every UIA round trip is bounded, because an unresponsive
//! provider must not blow the host's configure-acknowledgement budget (macOS bounds every AX read at
//! 0.5 s for the same reason).

use windows::core::{Interface, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::UI::Accessibility::{IUIAutomation, IUIAutomationElement, UIA_E_NOTSUPPORTED};

use crate::platform::{
    Availability, ElementCandidate, ElementState, ForegroundIdentity, ObservationSource,
    PlatformObservation,
};

/// The same bound the macOS collector applies to every Accessibility round trip.
const UIA_TIMEOUT_MS: u32 = 500;

pub struct WindowsSource {
    automation: Option<IUIAutomation>,
    unavailable: Option<String>,
}

impl WindowsSource {
    pub fn new() -> Self {
        unsafe {
            match automation_instance() {
                Ok(automation) => Self {
                    automation: Some(automation),
                    unavailable: None,
                },
                Err(error) => Self {
                    automation: None,
                    unavailable: Some(format!("UI Automation could not start: {error}")),
                },
            }
        }
    }
}

impl ObservationSource for WindowsSource {
    fn availability(&mut self) -> Availability {
        match (&self.automation, &self.unavailable) {
            (Some(_), _) => Availability::Available,
            (None, Some(reason)) => Availability::Unavailable(reason.clone()),
            (None, None) => Availability::Unavailable("UI Automation is not initialized".to_string()),
        }
    }

    fn foreground(&mut self) -> Option<ForegroundIdentity> {
        unsafe { foreground_identity() }
    }

    fn describe(&mut self, identity: &ForegroundIdentity) -> Option<PlatformObservation> {
        let automation = self.automation.clone()?;
        unsafe { describe_foreground(&automation, identity) }
    }

    fn idle_seconds(&mut self) -> Option<u64> {
        use windows::Win32::System::SystemInformation::GetTickCount64;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

        unsafe {
            let mut info = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            if !GetLastInputInfo(&mut info).as_bool() {
                return None;
            }
            Some(GetTickCount64().saturating_sub(info.dwTime as u64) / 1000)
        }
    }
}

unsafe fn foreground_identity() -> Option<ForegroundIdentity> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    let hwnd = GetForegroundWindow();
    if hwnd.0.is_null() {
        return None;
    }
    let mut process_id: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut process_id as *mut u32));
    if process_id == 0 {
        return None;
    }
    let pid = i32::try_from(process_id).ok()?;
    let image_path = process_image_path(process_id);
    let file_name = image_path
        .as_deref()
        .and_then(file_name_of)
        .map(str::to_string);
    let application_name = file_name.as_deref().map(display_name_of);
    // The window's AppUserModelID is the identity packaged applications *may* declare; the executable
    // name is what Windows reports for classic applications (explorer.exe, notepad.exe) and the
    // fallback here. Both are kept, because a rule or adapter table that knows only one of them must
    // still be able to match the window.
    let application_id = app_user_model_id(hwnd).or_else(|| file_name.clone())?;
    let application_executable = file_name
        .filter(|executable| !executable.eq_ignore_ascii_case(&application_id));
    Some(ForegroundIdentity {
        pid,
        window: hwnd.0 as isize,
        application_id,
        application_executable,
        application_name,
    })
}

unsafe fn describe_foreground(
    automation: &IUIAutomation,
    identity: &ForegroundIdentity,
) -> Option<PlatformObservation> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let hwnd = GetForegroundWindow();
    // The window handle, not the pid: a switch between two windows of the same process between the
    // gate and this read would otherwise pair one window's title with the other's identity.
    if hwnd.0.is_null() || hwnd.0 as isize != identity.window {
        return None;
    }

    let window_title = window_text(hwnd);
    let (element_role, element_state) = focused_element(automation);
    Some(PlatformObservation {
        pid: identity.pid,
        application_id: identity.application_id.clone(),
        application_name: identity.application_name.clone(),
        window_title,
        // UI Automation has no document/URL property equivalent to kAXDocument, and a title-derived
        // path would be a guess, so no document is recorded. A live measurement decides whether a
        // reliable source exists (the explorer address bar is the candidate).
        document: None,
        element_role,
        element_state,
    })
}

unsafe fn window_text(hwnd: HWND) -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextLengthW, GetWindowTextW};

    let length = GetWindowTextLengthW(hwnd);
    if length <= 0 {
        return None;
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = GetWindowTextW(hwnd, &mut buffer);
    if copied <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..copied as usize]))
}

unsafe fn process_image_path(process_id: u32) -> Option<String> {
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
    // Windows paths can exceed the classic MAX_PATH; a buffer that is too small makes the call fail
    // and the application silently loses its identity fallback.
    let mut buffer = vec![0u16; 32_768];
    let mut size = buffer.len() as u32;
    let result = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        PWSTR(buffer.as_mut_ptr()),
        &mut size,
    );
    let _ = CloseHandle(handle);
    result.ok()?;
    Some(String::from_utf16_lossy(&buffer[..size as usize]))
}

unsafe fn app_user_model_id(hwnd: HWND) -> Option<String> {
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc};
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};

    let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).ok()?;
    let mut value = store.GetValue(&PKEY_AppUserModel_ID).ok()?;
    let text = match PropVariantToStringAlloc(&value) {
        Ok(text) => text,
        Err(_) => {
            // The PROPVARIANT is owned by this process whether or not the string conversion worked.
            let _ = PropVariantClear(&mut value);
            return None;
        }
    };
    let result = text.to_string().ok().filter(|text| !text.is_empty());
    // Both allocations belong to this process: the PROPVARIANT and the string it produced.
    let _ = PropVariantClear(&mut value);
    CoTaskMemFree(Some(text.0 as *const core::ffi::c_void));
    result
}

unsafe fn focused_element(automation: &IUIAutomation) -> (Option<String>, ElementState) {
    match automation.GetFocusedElement() {
        Ok(element) => {
            let role = element
                .CurrentControlType()
                .ok()
                .map(|control_type| format!("ControlType.{}", control_type.0));
            let state = match element.CurrentIsPassword() {
                Ok(value) if value.as_bool() => ElementState::Secure,
                Ok(_) => ElementState::NotSecure,
                Err(error) => classify_element_error(&error),
            };
            (role, state)
        }
        Err(error) => (None, classify_element_error(&error)),
    }
}

/// The macOS collector's fail-closed split, in UIA's vocabulary: an element the provider says it does
/// not support is "no queryable element" (ADR 0006 window-only adapters may record window metadata);
/// anything else is "we could not ask" and withholds the metadata too.
fn classify_element_error(error: &windows::core::Error) -> ElementState {
    if error.code().0 as u32 == UIA_E_NOTSUPPORTED {
        ElementState::Unqueryable
    } else {
        ElementState::Unreadable
    }
}

fn file_name_of(path: &str) -> Option<&str> {
    path.rsplit(['\\', '/']).next().filter(|name| !name.is_empty())
}

fn display_name_of(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".exe") {
        file_name[..file_name.len() - 4].to_string()
    } else {
        file_name.to_string()
    }
}

/// The COM entry point, shared by the collector and by the measurement probe so both see the same timeouts.
unsafe fn automation_instance() -> windows::core::Result<IUIAutomation> {
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation2};

    // S_FALSE (already initialized on this thread) is fine; the HRESULT is ignored on purpose.
    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL)?;
    if let Ok(automation2) = automation.cast::<IUIAutomation2>() {
        let _ = automation2.SetConnectionTimeout(UIA_TIMEOUT_MS);
        let _ = automation2.SetTransactionTimeout(UIA_TIMEOUT_MS);
    }
    Ok(automation)
}

/// What UI Automation exposes around the foreground window that could anchor an observation.
///
/// Bounded on purpose: the focused element and three ancestors, then a breadth-first walk that keeps only
/// the elements which can carry a location (Edit, Document, ComboBox) until `limit` results, twenty times
/// that many visited nodes, or two seconds have passed. Nothing here is used by the collector yet.
pub fn anchor_candidates(limit: usize) -> Vec<ElementCandidate> {
    unsafe { anchor_candidates_impl(limit) }
}

unsafe fn anchor_candidates_impl(limit: usize) -> Vec<ElementCandidate> {
    use std::time::{Duration, Instant};
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let Ok(automation) = automation_instance() else {
        return Vec::new();
    };
    let hwnd = GetForegroundWindow();
    if hwnd.0.is_null() {
        return Vec::new();
    }
    let Ok(root) = automation.ElementFromHandle(hwnd) else {
        return Vec::new();
    };
    let Ok(walker) = automation.RawViewWalker() else {
        return Vec::new();
    };

    let mut out = Vec::new();
    push_candidate(&mut out, &root, "window");

    if let Ok(focused) = automation.GetFocusedElement() {
        push_candidate(&mut out, &focused, "focused");
        let mut node = focused;
        for _ in 0..3 {
            let Ok(parent) = walker.GetParentElement(&node) else {
                break;
            };
            push_candidate(&mut out, &parent, "ancestor");
            node = parent;
        }
    }

    let deadline = Instant::now() + Duration::from_secs(2);
    let mut queue = vec![root];
    let mut visited = 0usize;
    while let Some(element) = queue.pop() {
        if visited >= limit.saturating_mul(20) || out.len() >= limit || Instant::now() > deadline {
            break;
        }
        visited += 1;
        let mut child = walker.GetFirstChildElement(&element);
        while let Ok(node) = child {
            if is_location_bearing(&node) {
                push_candidate(&mut out, &node, "descendant");
            }
            queue.push(node.clone());
            child = walker.GetNextSiblingElement(&node);
        }
    }

    out
}

/// The control types that can name where the user is: an editor's document, a browser's or Explorer's
/// address bar, a combo box that shows a folder.
unsafe fn is_location_bearing(element: &IUIAutomationElement) -> bool {
    use windows::Win32::UI::Accessibility::{
        UIA_ComboBoxControlTypeId, UIA_DocumentControlTypeId, UIA_EditControlTypeId,
    };

    match element.CurrentControlType() {
        Ok(control_type) => {
            control_type == UIA_EditControlTypeId
                || control_type == UIA_DocumentControlTypeId
                || control_type == UIA_ComboBoxControlTypeId
        }
        Err(_) => false,
    }
}

unsafe fn push_candidate(
    out: &mut Vec<ElementCandidate>,
    element: &IUIAutomationElement,
    relation: &'static str,
) {
    out.push(ElementCandidate {
        relation,
        control_type: element
            .CurrentControlType()
            .ok()
            .map(|control_type| format!("ControlType.{}", control_type.0)),
        name: text_of(element.CurrentName()),
        automation_id: text_of(element.CurrentAutomationId()),
        class_name: text_of(element.CurrentClassName()),
        help_text: text_of(element.CurrentHelpText()),
        value: value_of(element),
        is_password: element.CurrentIsPassword().ok().map(|value| value.as_bool()),
    });
}

/// A UIA string property, with "the provider returned an empty string" treated as "no value".
fn text_of(value: windows::core::Result<windows::core::BSTR>) -> Option<String> {
    value
        .ok()
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty())
}

/// The Value pattern's text, which is where an address bar keeps the URL and a document keeps its path.
unsafe fn value_of(element: &IUIAutomationElement) -> Option<String> {
    use windows::Win32::UI::Accessibility::{IUIAutomationValuePattern, UIA_ValuePatternId};

    let pattern = element.GetCurrentPattern(UIA_ValuePatternId).ok()?;
    let value: IUIAutomationValuePattern = pattern.cast().ok()?;
    text_of(value.CurrentValue())
}
