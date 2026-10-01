// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ComputerHistoryCollector",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "dsh-computer-history-collector", targets: ["ComputerHistoryCollector"])],
    targets: [
        .executableTarget(name: "ComputerHistoryCollector"),
        .testTarget(name: "ComputerHistoryCollectorTests", dependencies: ["ComputerHistoryCollector"]),
    ]
)
