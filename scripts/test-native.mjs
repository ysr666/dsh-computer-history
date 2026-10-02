import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

if (process.platform !== 'darwin') {
  console.log(
    'native collector tests skipped: macOS only',
  )
  process.exit(0)
}

const developer =
  process.env.DEVELOPER_DIR
  ?? '/Applications/Xcode.app/Contents/Developer'
const sdk = path.join(
  developer,
  'Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk',
)
const swiftc = path.join(
  developer,
  'Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc',
)
const targetArch = process.arch === 'x64' ? 'x86_64' : 'arm64'
const root = mkdtempSync(
  path.join(os.tmpdir(), 'dsh-ch-native-test-'),
)
const testSource = path.join(root, 'NativeTests.swift')
const executable = path.join(root, 'native-tests')

function requireSource(condition, message) {
  if (!condition) throw new Error(message)
}

const collectorSource = readFileSync(
  'native/macos/Sources/ComputerHistoryCollector/Collector.swift',
  'utf8',
)
const mainSource = readFileSync(
  'native/macos/Sources/ComputerHistoryCollector/main.swift',
  'utf8',
)
requireSource(
  collectorSource.includes('heartbeatInterval: TimeInterval = 5'),
  'native collector must retain the 5s reconciliation heartbeat',
)
requireSource(
  collectorSource.includes('NSWorkspace.willSleepNotification')
    && collectorSource.includes('NSWorkspace.didWakeNotification'),
  'native collector must reconcile sleep/wake lifecycle',
)
requireSource(
  collectorSource.includes('guard fingerprint != lastObservationFingerprint'),
  'native heartbeat must suppress unchanged metadata',
)
const pauseSource = collectorSource.slice(
  collectorSource.indexOf('func setPaused'),
  collectorSource.indexOf('private func capture'),
)
requireSource(
  pauseSource.indexOf('detachAXObserver()') >= 0
    && pauseSource.indexOf('detachAXObserver()')
      < pauseSource.indexOf('state: "paused"'),
  'pause must detach AX observation before acknowledging paused',
)
const configureCase = mainSource.slice(
  mainSource.indexOf('case .configure'),
  mainSource.indexOf('case .pause'),
)
requireSource(
  configureCase.indexOf('collector.configure(policy)') >= 0
    && configureCase.indexOf('collector.configure(policy)')
      < configureCase.indexOf('ConfiguredMessage(revision: revision)'),
  'configured acknowledgement must follow policy application',
)

writeFileSync(testSource, `
import ApplicationServices
import Foundation

@main
struct NativeTests {
    static func main() throws {
        precondition(
            protectedBundles.contains(
                "com.1password.1password"
            )
        )
        precondition(
            protectedBundles.contains(
                "com.apple.keychainaccess"
            )
        )
        precondition(
            globMatches("*/.ssh/*", "/Users/demo/.ssh/id_rsa")
        )
        precondition(
            !globMatches("*.pem", "/tmp/readme.txt")
        )
        precondition(
            phase1AdapterForBundle("com.microsoft.VSCode") == "vscode"
        )
        precondition(
            phase1AdapterForBundle("com.google.Chrome") == nil
        )
        precondition(
            phase1AdapterForBundle("org.mozilla.firefox") == nil
        )

        // Secure-field detection must fail closed: an unreadable
        // focused element is not evidence that the surface is safe.
        precondition(isSecureElement(nil) == .unreadable)
        precondition(windowElement(from: nil) == nil)

        // A *missing* subrole is not a failed read. Secure fields are
        // defined by the AXSecureTextField subrole, while AXTextArea and
        // AXGroup commonly have none (real-host regression: Terminal's
        // focused AXTextArea was dropped as unreadable). Keep failing
        // closed for AXTextField, which is the role that can carry the
        // secure subrole.
        precondition(
            classifySecureFieldState(
                subroleStatus: .success,
                subrole: kAXSecureTextFieldSubrole as NSString,
                roleStatus: .success,
                role: nil
            ) == .secure
        )
        precondition(
            classifySecureFieldState(
                subroleStatus: .success,
                subrole: "AXStandardWindow" as NSString,
                roleStatus: .success,
                role: nil
            ) == .notSecure
        )
        precondition(
            classifySecureFieldState(
                subroleStatus: .noValue,
                subrole: nil,
                roleStatus: .success,
                role: kAXTextAreaRole as NSString
            ) == .notSecure
        )
        precondition(
            classifySecureFieldState(
                subroleStatus: .attributeUnsupported,
                subrole: nil,
                roleStatus: .success,
                role: kAXTextAreaRole as NSString
            ) == .notSecure
        )
        precondition(
            classifySecureFieldState(
                subroleStatus: .attributeUnsupported,
                subrole: nil,
                roleStatus: .success,
                role: kAXTextFieldRole as NSString
            ) == .unreadable
        )
        precondition(
            classifySecureFieldState(
                subroleStatus: .attributeUnsupported,
                subrole: nil,
                roleStatus: .cannotComplete,
                role: nil
            ) == .unreadable
        )
        precondition(
            classifySecureFieldState(
                subroleStatus: .noValue,
                subrole: nil,
                roleStatus: .success,
                role: kAXTextFieldRole as NSString
            ) == .unreadable
        )
        precondition(
            classifySecureFieldState(
                subroleStatus: .noValue,
                subrole: nil,
                roleStatus: .cannotComplete,
                role: nil
            ) == .unreadable
        )
        precondition(
            classifySecureFieldState(
                subroleStatus: .cannotComplete,
                subrole: nil,
                roleStatus: .success,
                role: nil
            ) == .unreadable
        )
        precondition(
            classifySecureFieldState(
                subroleStatus: .success,
                subrole: 42 as NSNumber,
                roleStatus: .success,
                role: nil
            ) == .unreadable
        )

        // Accessibility reads are bounded per element object, and the
        // URL helper must reject a value it cannot interpret rather
        // than silently yielding nil-string confusion.
        precondition(
            safeURL(
                AXUIElementCreateApplication(
                    ProcessInfo.processInfo.processIdentifier
                ),
                "AXURL"
            ) == nil
        )

        // Protected-path screening must cover every metadata field the
        // helper emits, not only the resource URI.
        precondition(
            looksLikeSensitiveResourcePath("/Users/demo/.env")
        )
        precondition(
            looksLikeSensitiveResourcePath(
                "file:///Users/demo/.ssh/id_rsa"
            )
        )
        precondition(
            looksLikeSensitiveResourcePath(
                "file:///Users/demo/credentials.json"
            )
        )
        precondition(
            !looksLikeSensitiveResourcePath("/Users/demo/notes.md")
        )
        precondition(
            isProtectedMetadata(
                "file:///Users/demo/.env",
                patterns: [],
                isResource: true
            )
        )
        precondition(
            isProtectedMetadata(
                ".env",
                patterns: [],
                isResource: false
            ) == false
        )
        precondition(
            isProtectedMetadata(
                "secret.pem",
                patterns: ["*.pem"],
                isResource: false
            )
        )
        precondition(
            isProtectedMetadata(
                "%2eenv",
                patterns: ["*.env"],
                isResource: false
            )
        )
        precondition(
            isProtectedMetadata(
                "/Users/demo/notes.md",
                patterns: ["*.pem"],
                isResource: false
            ) == false
        )
        precondition(
            isProtectedMetadata(
                nil,
                patterns: ["*.pem"],
                isResource: true
            ) == false
        )

        let json = """
        {
          "v": 1,
          "type": "configure",
          "revision": 7,
          "policy": {
            "mode": "include-only",
            "allowedBundleIds": ["com.microsoft.VSCode"],
            "blockedBundleIds": [],
            "protectedBundleIds": [],
            "protectedPathPatterns": ["*.pem"]
          }
        }
        """
        let command = try JSONDecoder().decode(
            Command.self,
            from: Data(json.utf8)
        )
        switch command {
        case .configure(let revision, let policy):
            precondition(revision == 7)
            precondition(policy.mode == "include-only")
            precondition(
                policy.allowedBundleIds
                    == ["com.microsoft.VSCode"]
            )
        default:
            preconditionFailure(
                "configure command decoded incorrectly"
            )
        }

        let invalidMode = """
        {
          "v": 1,
          "type": "configure",
          "revision": 8,
          "policy": {
            "mode": "exclude",
            "allowedBundleIds": [],
            "blockedBundleIds": [],
            "protectedBundleIds": [],
            "protectedPathPatterns": []
          }
        }
        """
        precondition(
            (try? JSONDecoder().decode(
                Command.self,
                from: Data(invalidMode.utf8)
            )) == nil
        )

        print("native privacy/protocol tests passed")
    }
}
`)

function run(command, args) {
  const result = spawnSync(
    command,
    args,
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

try {
  run(swiftc, [
    '-warnings-as-errors',
    '-sdk', sdk,
    '-target', targetArch + '-apple-macos13.0',
    'native/macos/Sources/ComputerHistoryCollector/Privacy.swift',
    'native/macos/Sources/ComputerHistoryCollector/SupportedApps.swift',
    'native/macos/Sources/ComputerHistoryCollector/Protocol.swift',
    testSource,
    '-o', executable,
  ])
  run(executable, [])
} finally {
  rmSync(root, { recursive: true, force: true })
}
