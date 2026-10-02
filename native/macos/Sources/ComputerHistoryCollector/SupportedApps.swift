import Foundation

/// One Phase 1 surface adapter.
///
/// Adding an adapter is a data change: append an entry here, then add its
/// real-machine evidence row in `docs/adapters.md`. Behaviour that used to be
/// a string comparison in the collector (title suppression) is a property of
/// the adapter, so it cannot drift away from the bundle identity.
struct Phase1Adapter {
    let id: String
    let bundleIds: [String]
    let surfaceKind: String
    /// Terminal windows carry the working directory, the running command and
    /// the session title, so their titles are never recorded. Verified for
    /// both Terminal and iTerm2 in the Phase 1 runtime validation.
    let suppressesWindowTitle: Bool
}

let phase1Adapters: [Phase1Adapter] = [
    Phase1Adapter(
        id: "vscode",
        bundleIds: [
            "com.microsoft.VSCode",
            "com.todesktop.230313mzl4w4u92",
        ],
        surfaceKind: "editor",
        suppressesWindowTitle: false
    ),
    Phase1Adapter(
        id: "xcode",
        bundleIds: ["com.apple.dt.Xcode"],
        surfaceKind: "editor",
        suppressesWindowTitle: false
    ),
    Phase1Adapter(
        id: "word",
        bundleIds: ["com.microsoft.Word"],
        surfaceKind: "document",
        suppressesWindowTitle: false
    ),
    Phase1Adapter(
        id: "wps",
        bundleIds: ["com.kingsoft.wpsoffice.mac"],
        surfaceKind: "window",
        suppressesWindowTitle: false
    ),
    Phase1Adapter(
        id: "terminal",
        bundleIds: [
            "com.apple.Terminal",
            "com.googlecode.iterm2",
        ],
        surfaceKind: "terminal",
        suppressesWindowTitle: true
    ),
    Phase1Adapter(
        id: "preview",
        bundleIds: ["com.apple.Preview"],
        surfaceKind: "document",
        suppressesWindowTitle: false
    ),
    Phase1Adapter(
        id: "finder",
        bundleIds: ["com.apple.finder"],
        surfaceKind: "window",
        suppressesWindowTitle: false
    ),
]

func phase1AdapterForBundle(
    _ bundle: String
) -> Phase1Adapter? {
    phase1Adapters.first { adapter in
        adapter.bundleIds.contains(bundle)
    }
}
