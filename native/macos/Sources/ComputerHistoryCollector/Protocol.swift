import Foundation

struct Hello: Encodable {
    let v = 1
    let type = "hello"
    let collectorSession: String
    let collectorVersion = "0.1.0"
    let platform = "darwin"
    let arch: String
    let capabilities = ["app-focus", "window-metadata", "resource-uri", "secure-field-detection"]
}

struct Privacy: Encodable { let secure: Bool; let protected: Bool; let reason: String? }
struct AppInfo: Encodable { let pid: Int32; let bundleId: String; let name: String? }
struct WindowInfo: Encodable { let title: String?; let document: String?; let url: String? }
struct ElementInfo: Encodable { let role: String?; let subrole: String?; let identifier: String? }
struct SourceInfo: Encodable { let adapter: String }

struct Observation: Encodable {
    let v = 1
    let type = "observation"
    let collectorSession: String
    let seq: Int
    let observedAtMs: Int64
    let app: AppInfo
    let window: WindowInfo?
    let element: ElementInfo?
    let activity: Activity?
    let privacy: Privacy
    let source: SourceInfo
}
struct Activity: Encodable { let idleSeconds: Double? }

struct StateMessage: Encodable {
    let v = 1
    let type = "state"
    let state: String
    let accessibilityTrusted: Bool
    let reason: String?
}

struct ConfigurePayload: Decodable {
    let mode: String
    let allowedBundleIds: [String]
    let blockedBundleIds: [String]
    let protectedBundleIds: [String]
    let protectedPathPatterns: [String]
}

struct ConfigureEnvelope: Decodable {
    let policy: ConfigurePayload
}

enum Command: Decodable {
    case configure(ConfigurePayload), pause, resume, shutdown
    private enum Keys: String, CodingKey { case v, type }
    init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: Keys.self)
        let version = try box.decode(Int.self, forKey: .v)
        guard version == 1 else {
            throw DecodingError.dataCorruptedError(
                forKey: .v,
                in: box,
                debugDescription: "unsupported protocol version"
            )
        }
        switch try box.decode(String.self, forKey: .type) {
        case "configure": self = .configure(try ConfigureEnvelope(from: decoder).policy)
        case "pause": self = .pause
        case "resume": self = .resume
        case "shutdown": self = .shutdown
        default: throw DecodingError.dataCorruptedError(forKey: .type, in: box, debugDescription: "unknown command")
        }
    }
}


func emit<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(value), let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}
