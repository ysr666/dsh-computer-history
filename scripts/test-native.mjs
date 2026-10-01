import {
  mkdtempSync,
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

writeFileSync(testSource, `
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

        let json = """
        {
          "v": 1,
          "type": "configure",
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
        case .configure(let policy):
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
