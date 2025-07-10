import Foundation
import AVFoundation
import CoreAudio
import os.log

// MARK: - Opus Encoder Interface
class OpusEncoder {
    private let sampleRate: Int32 = 48000
    private let channels: Int32 = 1
    private let bitrate: Int32 = 32000 // 32kbps as specified
    private let frameSize: Int32 = 960 // 20ms frame at 48kHz
    
    private var encoder: OpaquePointer?
    private let logger = Logger(subsystem: "com.granular.audio-capture", category: "OpusEncoder")
    
    init() throws {
        var error: Int32 = 0
        encoder = opus_encoder_create(sampleRate, channels, OPUS_APPLICATION_VOIP, &error)
        
        guard error == OPUS_OK, let encoder = encoder else {
            throw AudioCaptureError.opusInitializationFailed
        }
        
        // Set bitrate
        let _ = opus_encoder_ctl(encoder, OPUS_SET_BITRATE_REQUEST, bitrate)
        
        logger.info("Opus encoder initialized: \(self.sampleRate)Hz, \(self.channels) channel(s), \(self.bitrate)bps")
    }
    
    deinit {
        if let encoder = encoder {
            opus_encoder_destroy(encoder)
        }
    }
    
    func encode(pcmData: UnsafePointer<Float>, frameSize: Int32) throws -> Data {
        guard let encoder = encoder else {
            throw AudioCaptureError.opusEncodingFailed
        }
        
        // Convert Float32 PCM to Int16
        let int16Buffer = UnsafeMutablePointer<Int16>.allocate(capacity: Int(frameSize))
        defer { int16Buffer.deallocate() }
        
        for i in 0..<Int(frameSize) {
            let sample = pcmData[i]
            let clampedSample = max(-1.0, min(1.0, sample))
            int16Buffer[i] = Int16(clampedSample * 32767.0)
        }
        
        // Encode to Opus
        let maxOutputSize = 4000 // Max Opus packet size
        let outputBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: maxOutputSize)
        defer { outputBuffer.deallocate() }
        
        let encodedBytes = opus_encode(encoder, int16Buffer, frameSize, outputBuffer, Int32(maxOutputSize))
        
        guard encodedBytes > 0 else {
            throw AudioCaptureError.opusEncodingFailed
        }
        
        return Data(bytes: outputBuffer, count: Int(encodedBytes))
    }
}

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
    private var opusEncoder: OpusEncoder?
    private var outputFileHandle: FileHandle?
    private var isPaused = false
    private var frameBuffer: [Float] = []
    private let frameSize: Int = 960 // 20ms at 48kHz
    private let logger = Logger(subsystem: "com.granular.audio-capture", category: "AudioRecording")
    
    func startRecording(outputPath: String, bitrate: Int = 32000) throws {
        logger.info("Starting Opus audio recording to: \(outputPath)")
        
        // Request microphone permission
        try requestMicrophonePermission()
        
        // Initialize Opus encoder
        opusEncoder = try OpusEncoder()
        
        // Create output file
        let outputURL = URL(fileURLWithPath: outputPath)
        FileManager.default.createFile(atPath: outputPath, contents: nil, attributes: nil)
        outputFileHandle = try FileHandle(forWritingTo: outputURL)
        
        // Write Opus file header (simple format)
        try writeOpusHeader()
        
        // Create audio engine
        audioEngine = AVAudioEngine()
        guard let audioEngine = audioEngine else {
            throw AudioCaptureError.engineInitializationFailed
        }
        
        // Set up recording
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        
        print("Input format: \(recordingFormat)")
        print("Target: 48kHz mono for Opus encoding")
        
        // Set up audio tap
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, time in
            guard let self = self, !self.isPaused else { return }
            
            do {
                try self.processAudioBuffer(buffer)
            } catch {
                print("Error processing audio buffer: \(error)")
                self.logger.error("Error processing audio buffer: \(error.localizedDescription)")
            }
        }
        
        print("Starting audio engine...")
        try audioEngine.start()
        print("Opus recording started successfully")
        
        // Set up signal handlers
        setupSignalHandlers()
        
        logger.info("Opus audio recording started successfully")
    }
    
    func pauseRecording() {
        logger.info("Pausing Opus recording")
        isPaused = true
    }
    
    func resumeRecording() {
        logger.info("Resuming Opus recording")
        isPaused = false
    }
    
    func stopRecording() {
        logger.info("Stopping Opus recording")
        
        // Flush any remaining audio data
        flushRemainingFrames()
        
        // Clean up
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        outputFileHandle?.closeFile()
        
        audioEngine = nil
        opusEncoder = nil
        outputFileHandle = nil
        
        logger.info("Opus recording stopped successfully")
    }
    
    private func writeOpusHeader() throws {
        // Simple Opus file format (OggOpus would be more complex)
        // For now, write a simple header with magic bytes and format info
        let header = "OPUS".data(using: .ascii)! + 
                    Data([0x01, 0x00]) + // Version
                    Data([0x01]) + // Channel count
                    Data([0x80, 0xBB, 0x00, 0x00]) + // Sample rate (48000)
                    Data([0x00, 0x7D, 0x00, 0x00]) // Bitrate (32000)
        
        try outputFileHandle?.write(contentsOf: header)
    }
    
    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) throws {
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frameLength = Int(buffer.frameLength)
        
        // Convert to mono if needed and add to frame buffer
        for i in 0..<frameLength {
            frameBuffer.append(channelData[i])
            
            // When we have enough samples for a frame, encode it
            if frameBuffer.count >= frameSize {
                try encodeFrame()
            }
        }
    }
    
    private func encodeFrame() throws {
        guard frameBuffer.count >= frameSize,
              let encoder = opusEncoder,
              let fileHandle = outputFileHandle else { return }
        
        // Extract frame
        let frame = Array(frameBuffer.prefix(frameSize))
        frameBuffer.removeFirst(frameSize)
        
        // Encode frame
        let encodedData = try frame.withUnsafeBufferPointer { buffer in
            return try encoder.encode(pcmData: buffer.baseAddress!, frameSize: Int32(self.frameSize))
        }
        
        // Write frame size + encoded data
        var frameSizeBytes = UInt32(encodedData.count)
        let frameSizeData = Data(bytes: &frameSizeBytes, count: 4)
        
        try fileHandle.write(contentsOf: frameSizeData)
        try fileHandle.write(contentsOf: encodedData)
    }
    
    private func flushRemainingFrames() {
        // Pad remaining samples with zeros if needed
        while frameBuffer.count >= frameSize {
            do {
                try encodeFrame()
            } catch {
                print("Error flushing remaining frames: \(error)")
                break
            }
        }
    }
    
    private func requestMicrophonePermission() throws {
        let semaphore = DispatchSemaphore(value: 0)
        var permissionGranted = false
        
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        print("Microphone permission status: \(status.rawValue)")
        
        switch status {
        case .authorized:
            print("Microphone permission already granted")
            permissionGranted = true
        case .denied:
            print("Microphone permission denied")
            throw AudioCaptureError.permissionDenied
        case .restricted:
            print("Microphone access restricted")
            throw AudioCaptureError.permissionDenied
        case .notDetermined:
            print("Requesting microphone permission...")
            AVCaptureDevice.requestAccess(for: .audio) { granted in
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
        signal(SIGUSR1) { _ in }
        signal(SIGUSR2) { _ in }
        signal(SIGTERM) { _ in exit(0) }
    }
}

// MARK: - Global recording manager
var globalRecordingManager: AudioRecordingManager?

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
    case opusInitializationFailed
    case opusEncodingFailed
    case invalidArguments
    case fileCreationFailed
    
    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Microphone permission denied"
        case .engineInitializationFailed:
            return "Failed to initialize audio engine"
        case .opusInitializationFailed:
            return "Failed to initialize Opus encoder"
        case .opusEncodingFailed:
            return "Failed to encode audio with Opus"
        case .invalidArguments:
            return "Invalid command line arguments"
        case .fileCreationFailed:
            return "Failed to create output file"
        }
    }
}

// MARK: - Opus C API Bindings
@_silgen_name("opus_encoder_create")
func opus_encoder_create(_ sampleRate: Int32, _ channels: Int32, _ application: Int32, _ error: UnsafeMutablePointer<Int32>) -> OpaquePointer?

@_silgen_name("opus_encoder_destroy")
func opus_encoder_destroy(_ encoder: OpaquePointer)

@_silgen_name("opus_encode")
func opus_encode(_ encoder: OpaquePointer, _ pcm: UnsafePointer<Int16>, _ frameSize: Int32, _ data: UnsafeMutablePointer<UInt8>, _ maxDataBytes: Int32) -> Int32

@_silgen_name("opus_encoder_ctl")
func opus_encoder_ctl(_ encoder: OpaquePointer, _ request: Int32, _ value: Int32) -> Int32

// Opus constants
let OPUS_OK: Int32 = 0
let OPUS_APPLICATION_VOIP: Int32 = 2048
let OPUS_SET_BITRATE_REQUEST: Int32 = 4002

// Remove this function as it's not needed

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
    
    guard let action = parseAction(actionString) else {
        print("Error: Invalid action '\(actionString)'")
        return nil
    }
    
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
    case "start": return .start
    case "pause": return .pause
    case "resume": return .resume
    case "stop": return .stop
    case "version", "--version", "-v": return .version
    default: return nil
    }
}

func printUsage() {
    print("""
    Granular Audio Capture v1.0.0 - Opus Edition
    
    Usage: audio-capture <action> [options]
    
    Actions:
        start       Start Opus-encoded microphone recording
        pause       Pause active recording
        resume      Resume paused recording
        stop        Stop active recording
        version     Show version information
    
    Options:
        --output <path>     Output file path (required for start) - .opus extension
        --session-id <id>   Session ID for pause/resume/stop
        --bitrate <rate>    Audio bitrate in bps (default: 32000)
    
    Examples:
        audio-capture start --output /path/to/recording.opus --bitrate 32000
        audio-capture pause --session-id 123
        audio-capture resume --session-id 123
        audio-capture stop --session-id 123
    
    Output: Opus-encoded audio files (~240KB per minute at 32kbps)
    """)
}

// MARK: - Main Application Logic
func main() {
    guard let command = parseArguments() else {
        exit(1)
    }
    
    let recordingManager = AudioRecordingManager()
    globalRecordingManager = recordingManager
    
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
            
            print("Opus recording started. Send SIGUSR1 to pause, SIGUSR2 to resume, SIGTERM to stop.")
            print("Process ID: \(ProcessInfo.processInfo.processIdentifier)")
            print("Target file size: ~240KB per minute at 32kbps")
            
            RunLoop.main.run()
            
        case .pause:
            print("Use kill -USR1 <process_id> to pause recording")
            
        case .resume:
            print("Use kill -USR2 <process_id> to resume recording")
            
        case .stop:
            print("Use kill -TERM <process_id> to stop recording")
            
        case .version:
            print("Granular Audio Capture v1.0.0 - Opus Edition")
            print("Opus-encoded microphone recording utility")
            print("Target: 32kbps, ~240KB per minute")
        }
    } catch {
        print("Error: \(error.localizedDescription)")
        exit(1)
    }
}

// MARK: - Application Entry Point
main()