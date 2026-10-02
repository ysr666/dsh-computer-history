import Foundation

/// What the adapter's application guarantees about focused elements.
enum FocusedElementPolicy {
    /// Default: the application must expose a queryable focused element, and an
    /// unqueryable one withholds the observation.
    case require
    /// The application's Accessibility bridge exposes no queryable focused
    /// element, and its own UI renders text fields itself, so window metadata
    /// may be recorded without element fields (ADR 0006). A readable secure
    /// field still withholds the observation.
    case windowOnly
}

/// One surface adapter.
///
/// Adding an adapter is a data change: append an entry here, then add its
/// real-machine evidence row in `docs/adapters.md`. Behaviour that used to be a
/// string comparison in the collector (title suppression, focus policy) is a
/// property of the adapter, so it cannot drift away from the bundle identity.
struct Phase1Adapter {
    let id: String
    let bundleIds: [String]
    let surfaceKind: String
    /// Terminal windows carry the working directory, the running command and
    /// the session title, so their titles are never recorded. Verified for
    /// both Terminal and iTerm2 in the Phase 1 runtime validation.
    let suppressesWindowTitle: Bool
    let focusedElementPolicy: FocusedElementPolicy
}

let phase1Adapters: [Phase1Adapter] = [
    Phase1Adapter(
        id: "vscode",
        bundleIds: [
            "com.microsoft.VSCode",
            "com.todesktop.230313mzl4w4u92",
        ],
        surfaceKind: "editor",
        suppressesWindowTitle: false,
        focusedElementPolicy: .require
    ),
    Phase1Adapter(
        id: "xcode",
        bundleIds: ["com.apple.dt.Xcode"],
        surfaceKind: "editor",
        suppressesWindowTitle: false,
        focusedElementPolicy: .require
    ),
    Phase1Adapter(
        id: "word",
        bundleIds: ["com.microsoft.Word"],
        surfaceKind: "document",
        suppressesWindowTitle: false,
        focusedElementPolicy: .require
    ),
    Phase1Adapter(
        id: "wps",
        bundleIds: ["com.kingsoft.wpsoffice.mac"],
        surfaceKind: "window",
        suppressesWindowTitle: false,
        focusedElementPolicy: .require
    ),
    Phase1Adapter(
        id: "jetbrains",
        // IntelliJ-platform applications. Measured on Android Studio
        // 2026-10-02: the focused element reference rejects every read
        // (-25202) while the window reads normally, which is why this adapter
        // declares `windowOnly` under ADR 0006. The other bundle ids share the
        // platform and were not installed on the validation machine.
        bundleIds: [
            "com.google.android.studio",
            "com.jetbrains.intellij",
            "com.jetbrains.intellij.ce",
            "com.jetbrains.pycharm",
            "com.jetbrains.pycharm.ce",
            "com.jetbrains.goland",
            "com.jetbrains.webstorm",
            "com.jetbrains.clion",
            "com.jetbrains.rustrover",
            "com.jetbrains.datagrip",
        ],
        surfaceKind: "editor",
        suppressesWindowTitle: false,
        focusedElementPolicy: .windowOnly
    ),
    Phase1Adapter(
        id: "notes",
        // Measured 2026-10-02: the focused element is readable (subrole absent,
        // like other AppKit text surfaces), the window document is nil and
        // kAXURL is unsupported, so a note is a title-only surface.
        bundleIds: ["com.apple.Notes"],
        surfaceKind: "window",
        suppressesWindowTitle: false,
        focusedElementPolicy: .require
    ),
    Phase1Adapter(
        id: "terminal",
        bundleIds: [
            "com.apple.Terminal",
            "com.googlecode.iterm2",
        ],
        surfaceKind: "terminal",
        suppressesWindowTitle: true,
        focusedElementPolicy: .require
    ),
    Phase1Adapter(
        id: "preview",
        bundleIds: ["com.apple.Preview"],
        surfaceKind: "document",
        suppressesWindowTitle: false,
        focusedElementPolicy: .require
    ),
    Phase1Adapter(
        id: "finder",
        bundleIds: ["com.apple.finder"],
        surfaceKind: "window",
        suppressesWindowTitle: false,
        focusedElementPolicy: .require
    ),
]

func phase1AdapterForBundle(
    _ bundle: String
) -> Phase1Adapter? {
    phase1Adapters.first { adapter in
        adapter.bundleIds.contains(bundle)
    }
}
