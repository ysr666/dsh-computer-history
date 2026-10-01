import ApplicationServices
import Foundation

func accessibilityTrustWithPrompt() -> Bool {
    if AXIsProcessTrusted() {
        return true
    }

    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let options = [key: true] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

let collector = Collector()
let arch: String
#if arch(arm64)
arch = "arm64"
#else
arch = "x64"
#endif

let trusted = accessibilityTrustWithPrompt()

emit(Hello(
    collectorSession: collector.session,
    arch: arch
))
emit(StateMessage(
    state: trusted ? "running" : "permission-required",
    accessibilityTrusted: trusted,
    reason: trusted ? nil : "accessibility"
))
collector.start()

DispatchQueue.global(qos: .utility).async {
    let decoder = JSONDecoder()
    while let line = readLine() {
        guard
            let data = line.data(using: .utf8),
            let command = try? decoder.decode(
                Command.self,
                from: data
            )
        else {
            continue
        }

        DispatchQueue.main.async {
            switch command {
            case .configure(let policy):
                collector.configure(policy)
            case .pause:
                collector.setPaused(true)
            case .resume:
                collector.setPaused(false)
            case .shutdown:
                collector.stop()
                exit(0)
            }
        }
    }

    DispatchQueue.main.async {
        collector.stop()
        exit(0)
    }
}

RunLoop.main.run()
