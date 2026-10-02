import XCTest

final class SupportedAppsTests: XCTestCase {
    func testRegistryInvariants() {
        XCTAssertFalse(phase1Adapters.isEmpty)

        for adapter in phase1Adapters {
            XCTAssertFalse(
                adapter.id.isEmpty,
                "every adapter needs an id"
            )
            XCTAssertFalse(
                adapter.bundleIds.isEmpty,
                "\(adapter.id) has no bundle ids"
            )
            XCTAssertFalse(
                adapter.surfaceKind.isEmpty,
                "\(adapter.id) has no surface kind"
            )
        }

        let ids = phase1Adapters.map(\.id)
        XCTAssertEqual(
            Set(ids).count,
            ids.count,
            "adapter ids must be unique"
        )

        let bundles = phase1Adapters.flatMap(\.bundleIds)
        XCTAssertEqual(
            Set(bundles).count,
            bundles.count,
            "a bundle id must belong to exactly one adapter"
        )
    }

    func testSupportedBundlesResolveToTheirAdapter() {
        let expected: [String: String] = [
            "com.microsoft.VSCode": "vscode",
            "com.todesktop.230313mzl4w4u92": "vscode",
            "com.apple.Terminal": "terminal",
            "com.googlecode.iterm2": "terminal",
            "com.apple.Preview": "preview",
            "com.apple.finder": "finder",
        ]
        for (bundle, id) in expected {
            XCTAssertEqual(
                phase1AdapterForBundle(bundle)?.id,
                id,
                "\(bundle) should resolve to \(id)"
            )
        }
        XCTAssertNil(phase1AdapterForBundle("com.google.Chrome"))
        XCTAssertNil(phase1AdapterForBundle("org.mozilla.firefox"))
        XCTAssertNil(phase1AdapterForBundle(""))
    }

    func testTitlePolicyBelongsToTheAdapter() {
        // Terminal windows carry cwd/command/session text; both terminal
        // bundle ids share the adapter, so both suppress titles.
        XCTAssertEqual(
            phase1AdapterForBundle("com.apple.Terminal")?
                .suppressesWindowTitle,
            true
        )
        XCTAssertEqual(
            phase1AdapterForBundle("com.googlecode.iterm2")?
                .suppressesWindowTitle,
            true
        )
        XCTAssertEqual(
            phase1AdapterForBundle("com.microsoft.VSCode")?
                .suppressesWindowTitle,
            false
        )
        XCTAssertEqual(
            phase1AdapterForBundle("com.apple.finder")?
                .suppressesWindowTitle,
            false
        )
    }

    func testSurfaceKindsAreTheHostVocabulary() {
        // src/host/ingestion/normalize.ts maps adapter ids to these surface
        // kinds; the registry must not invent a new one silently.
        let allowed: Set<String> = [
            "editor",
            "terminal",
            "document",
            "window",
        ]
        for adapter in phase1Adapters {
            XCTAssertTrue(
                allowed.contains(adapter.surfaceKind),
                "\(adapter.id) uses unknown surface kind "
                    + "\(adapter.surfaceKind)"
            )
        }
    }
}
