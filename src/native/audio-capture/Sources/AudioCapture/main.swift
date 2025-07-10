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
        
        // Request microphone permission (macOS approach)
        try requestMicrophonePermission()
        
        // Create audio engine
        audioEngine = AVAudioEngine()
        
        guard let audioEngine = audioEngine else {
            throw AudioCaptureError.engineInitializationFailed
        }
        
        // Set up recording format for macOS
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        
        // Create output file with simpler PCM format first
        let outputURL = URL(fileURLWithPath: outputPath)
        
        // Use a simpler format that's more likely to work
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,  // Start with mono
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsNonInterleaved: false
        ]
        
        print("Creating audio file with settings: \(settings)")
        outputFile = try AVAudioFile(forWriting: outputURL, settings: settings)
        
        print("Input node format: \(recordingFormat)")
        print("Setting up audio tap...")
        
        // Set up audio tap for recording
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, time in
            guard let self = self, !self.isPaused else { return }
            
            do {
                // Convert buffer format if needed
                if let outputFile = self.outputFile {
                    try outputFile.write(from: buffer)
                }
            } catch {
                print("Error writing audio buffer: \(error.localizedDescription)")
                self.logger.error("Error writing audio buffer: \(error.localizedDescription)")
            }
        }
        
        print("Starting audio engine...")
        // Start the engine
        try audioEngine.start()
        print("Audio engine started successfully")
        
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
    
    private func requestMicrophonePermission() throws {
        // For macOS, check current microphone permission status
        let semaphore = DispatchSemaphore(value: 0)
        var permissionGranted = false
        
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        print("Current microphone permission status: \(status.rawValue)")
        
        switch status {
        case .authorized:
            print("Microphone permission already granted")
            permissionGranted = true
        case .denied:
            print("Microphone permission denied by user")
            print("Please grant microphone permission in System Preferences > Security & Privacy > Privacy > Microphone")
            throw AudioCaptureError.permissionDenied
        case .restricted:
            print("Microphone access restricted")
            throw AudioCaptureError.permissionDenied
        case .notDetermined:
            print("Requesting microphone permission...")
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                permissionGranted = granted
                if granted {
                    print("Microphone permission granted by user")
                } else {
                    print("Microphone permission denied by user")
                }
                semaphore.signal()
            }
            semaphore.wait()
        @unknown default:
            print("Unknown microphone permission status")
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

// MARK: - Global recording manager instance
var globalRecordingManager: AudioRecordingManager?

// MARK: - Signal handler functions
func handlePauseSignal() {
    globalRecordingManager?.pauseRecording()
}

func handleResumeSignal() {
    globalRecordingManager?.resumeRecording()
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
            return "Microphone permission denied"
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
        start       Start microphone recording
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
    
    Note: This captures microphone input, not system audio on macOS.
    """)
}

// MARK: - Main Application Logic
func main() {
    guard let command = parseArguments() else {
        exit(1)
    }
    
    let recordingManager = AudioRecordingManager()
    globalRecordingManager = recordingManager
    
    // Set up signal handlers
    signal(SIGUSR1, { _ in handlePauseSignal() })
    signal(SIGUSR2, { _ in handleResumeSignal() })
    
    do {
        switch command.action {
        case .start:
            guard let outputPath = command.outputPath else {
                print("Error: --output is required for start action")
                exit(1)
            }
            
            try recordingManager.startRecording(outputPath: outputPath, bitrate: command.bitrate)
            
            // Keep the process running
            print("Recording started. Send SIGUSR1 to pause, SIGUSR2 to resume, SIGTERM to stop.")
            print("Process ID: \(ProcessInfo.processInfo.processIdentifier)")
            
            // Run the main run loop
            RunLoop.main.run()
            
        case .pause:
            print("Pause functionality requires process ID management")
            print("Use kill -USR1 <process_id> to pause recording")
            
        case .resume:
            print("Resume functionality requires process ID management")
            print("Use kill -USR2 <process_id> to resume recording")
            
        case .stop:
            print("Stop functionality requires process ID management")
            print("Use kill -TERM <process_id> to stop recording")
            
        case .version:
            print("Granular Audio Capture v1.0.0")
            print("macOS Microphone Recording Utility")
            print("Built with Swift 6.1")
        }
    } catch {
        print("Error: \(error.localizedDescription)")
        exit(1)
    }
}

// MARK: - Application Entry Point
main()