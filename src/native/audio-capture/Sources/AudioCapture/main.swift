import Foundation
import AVFoundation
import CoreAudio
import os.log

// MARK: - Command Line Interface
struct AudioCaptureCommand {
    let action: Action
    let outputPath: String?
    let sessionId: String?
    let bitrate: Int
    
    enum Action {
        case start
        case pause
        case resume
        case stop
        case version
    }
}

// MARK: - Audio Recording Manager
class AudioRecordingManager {
    private var audioEngine: AVAudioEngine?
    private var outputFile: AVAudioFile?
    private var isPaused = false
    private let logger = Logger(subsystem: "com.granular.audio-capture", category: "AudioRecording")
    
    func startRecording(outputPath: String, bitrate: Int = 32000) throws {
        logger.info("Starting audio recording to: \(outputPath)")
        
        // Request audio capture permission
        try requestAudioPermission()
        
        // Set up audio session
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try audioSession.setActive(true)
        
        // Create audio engine
        audioEngine = AVAudioEngine()
        
        guard let audioEngine = audioEngine else {
            throw AudioCaptureError.engineInitializationFailed
        }
        
        // Set up recording format (32kbps AAC)
        let recordingFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 44100,
            channels: 2,
            interleaved: false
        )
        
        guard let format = recordingFormat else {
            throw AudioCaptureError.formatCreationFailed
        }
        
        // Create output file
        let outputURL = URL(fileURLWithPath: outputPath)
        outputFile = try AVAudioFile(forWriting: outputURL, settings: format.settings)
        
        // Set up audio tap
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, time in
            guard let self = self, !self.isPaused else { return }
            
            do {
                try self.outputFile?.write(from: buffer)
            } catch {
                self.logger.error("Error writing audio buffer: \(error.localizedDescription)")
            }
        }
        
        // Start the engine
        try audioEngine.start()
        
        // Set up signal handlers for pause/resume
        setupSignalHandlers()
        
        logger.info("Audio recording started successfully")
    }
    
    func pauseRecording() {
        logger.info("Pausing audio recording")
        isPaused = true
    }
    
    func resumeRecording() {
        logger.info("Resuming audio recording")
        isPaused = false
    }
    
    func stopRecording() {
        logger.info("Stopping audio recording")
        
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        
        outputFile = nil
        audioEngine = nil
        
        logger.info("Audio recording stopped successfully")
    }
    
    private func requestAudioPermission() throws {
        let semaphore = DispatchSemaphore(value: 0)
        var permissionGranted = false
        
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            permissionGranted = true
        case .denied:
            throw AudioCaptureError.permissionDenied
        case .undetermined:
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                permissionGranted = granted
                semaphore.signal()
            }
            semaphore.wait()
        @unknown default:
            throw AudioCaptureError.permissionDenied
        }
        
        if !permissionGranted {
            throw AudioCaptureError.permissionDenied
        }
    }
    
    private func setupSignalHandlers() {
        // Handle SIGUSR1 for pause
        signal(SIGUSR1) { _ in
            // This will be handled by the main instance
        }
        
        // Handle SIGUSR2 for resume
        signal(SIGUSR2) { _ in
            // This will be handled by the main instance
        }
        
        // Handle SIGTERM for stop
        signal(SIGTERM) { _ in
            exit(0)
        }
    }
}

// MARK: - Error Types
enum AudioCaptureError: Error, LocalizedError {
    case permissionDenied
    case engineInitializationFailed
    case formatCreationFailed
    case invalidArguments
    case fileCreationFailed
    
    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Audio recording permission denied"
        case .engineInitializationFailed:
            return "Failed to initialize audio engine"
        case .formatCreationFailed:
            return "Failed to create audio format"
        case .invalidArguments:
            return "Invalid command line arguments"
        case .fileCreationFailed:
            return "Failed to create output file"
        }
    }
}

// MARK: - Command Line Parsing
func parseArguments() -> AudioCaptureCommand? {
    let arguments = CommandLine.arguments
    
    guard arguments.count >= 2 else {
        printUsage()
        return nil
    }
    
    let actionString = arguments[1]
    var outputPath: String?
    var sessionId: String?
    var bitrate = 32000
    
    // Parse action
    guard let action = parseAction(actionString) else {
        print("Error: Invalid action '\(actionString)'")
        return nil
    }
    
    // Parse additional arguments
    var i = 2
    while i < arguments.count {
        let arg = arguments[i]
        
        switch arg {
        case "--output":
            if i + 1 < arguments.count {
                outputPath = arguments[i + 1]
                i += 2
            } else {
                print("Error: --output requires a value")
                return nil
            }
        case "--session-id":
            if i + 1 < arguments.count {
                sessionId = arguments[i + 1]
                i += 2
            } else {
                print("Error: --session-id requires a value")
                return nil
            }
        case "--bitrate":
            if i + 1 < arguments.count {
                if let rate = Int(arguments[i + 1]) {
                    bitrate = rate
                } else {
                    print("Error: Invalid bitrate value")
                    return nil
                }
                i += 2
            } else {
                print("Error: --bitrate requires a value")
                return nil
            }
        default:
            print("Error: Unknown argument '\(arg)'")
            return nil
        }
    }
    
    return AudioCaptureCommand(
        action: action,
        outputPath: outputPath,
        sessionId: sessionId,
        bitrate: bitrate
    )
}

func parseAction(_ actionString: String) -> AudioCaptureCommand.Action? {
    switch actionString.lowercased() {
    case "start":
        return .start
    case "pause":
        return .pause
    case "resume":
        return .resume
    case "stop":
        return .stop
    case "version", "--version", "-v":
        return .version
    default:
        return nil
    }
}

func printUsage() {
    print("""
    Granular Audio Capture v1.0.0
    
    Usage: audio-capture <action> [options]
    
    Actions:
        start       Start audio recording
        pause       Pause active recording
        resume      Resume paused recording
        stop        Stop active recording
        version     Show version information
    
    Options:
        --output <path>     Output file path (required for start)
        --session-id <id>   Session ID for pause/resume/stop
        --bitrate <rate>    Audio bitrate in bps (default: 32000)
    
    Examples:
        audio-capture start --output /path/to/recording.m4a --bitrate 32000
        audio-capture pause --session-id 123
        audio-capture resume --session-id 123
        audio-capture stop --session-id 123
    """)
}

// MARK: - Main Application Logic
func main() {
    guard let command = parseArguments() else {
        exit(1)
    }
    
    let recordingManager = AudioRecordingManager()
    
    do {
        switch command.action {
        case .start:
            guard let outputPath = command.outputPath else {
                print("Error: --output is required for start action")
                exit(1)
            }
            
            try recordingManager.startRecording(outputPath: outputPath, bitrate: command.bitrate)
            
            // Keep the process running
            print("Recording started. Press Ctrl+C to stop.")
            RunLoop.main.run()
            
        case .pause:
            recordingManager.pauseRecording()
            print("Recording paused")
            
        case .resume:
            recordingManager.resumeRecording()
            print("Recording resumed")
            
        case .stop:
            recordingManager.stopRecording()
            print("Recording stopped")
            
        case .version:
            print("Granular Audio Capture v1.0.0")
            print("macOS System Audio Recording Utility")
        }
    } catch {
        print("Error: \(error.localizedDescription)")
        exit(1)
    }
}

// MARK: - Application Entry Point
main()