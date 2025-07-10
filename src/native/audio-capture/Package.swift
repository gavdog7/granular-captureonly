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
    dependencies: [],
    targets: [
        .executableTarget(
            name: "AudioCapture",
            dependencies: [],
            path: "Sources/AudioCapture",
            linkerSettings: [
                .linkedLibrary("opus"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreAudio"),
                .unsafeFlags(["-L/opt/homebrew/lib", "-I/opt/homebrew/include"])
            ]
        )
    ]
)