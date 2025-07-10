// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "audio-capture",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "audio-capture", targets: ["AudioCapture"])
    ],
    dependencies: [
        // Add dependencies here if needed
    ],
    targets: [
        .executableTarget(
            name: "AudioCapture",
            dependencies: [],
            path: "Sources/AudioCapture"
        )
    ]
)