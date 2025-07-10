import Foundation
import AVFoundation
import CoreAudio
import os.log

// MARK: - Ogg Container Support
class OggOpusWriter {
    private var fileHandle: FileHandle
    private var sequenceNumber: UInt32 = 0
    private var granulePosition: UInt64 = 0
    private let streamSerialNumber: UInt32
    private let logger = Logger(subsystem: "com.granular.audio-capture", category: "OggOpusWriter")
    
    init(fileHandle: FileHandle) {
        self.fileHandle = fileHandle
        self.streamSerialNumber = UInt32.random(in: 1...UInt32.max)
    }
    
    func writeOpusHeadPage(channels: UInt8, inputSampleRate: UInt32, preSkip: UInt16 = 312) throws {
        // Create OpusHead packet
        var opusHead = Data()
        opusHead.append("OpusHead".data(using: .ascii)!) // Magic signature
        opusHead.append(1) // Version
        opusHead.append(channels) // Channel count
        opusHead.append(Data(withUnsafeBytes(of: preSkip.littleEndian) { Data($0) })) // Pre-skip (little-endian)
        opusHead.append(Data(withUnsafeBytes(of: inputSampleRate.littleEndian) { Data($0) })) // Input sample rate
        opusHead.append(Data([0x00, 0x00])) // Output gain (0 dB)
        opusHead.append(0) // Channel mapping family (0 = mono/stereo)
        
        try writeOggPage(packets: [opusHead], isFirstPage: true, isLastPage: false, granulePos: 0)
        logger.info("Wrote OpusHead page with \(channels) channel(s), \(inputSampleRate)Hz")
    }
    
    func writeOpusTagsPage() throws {
        // Create OpusTags packet
        var opusTags = Data()
        opusTags.append("OpusTags".data(using: .ascii)!) // Magic signature
        
        let vendor = "Granular Audio Capture v1.0.0"
        let vendorData = vendor.data(using: .utf8)!
        opusTags.append(Data(withUnsafeBytes(of: UInt32(vendorData.count).littleEndian) { Data($0) }))
        opusTags.append(vendorData)
        
        // User comment list length (0 comments)
        opusTags.append(Data(withUnsafeBytes(of: UInt32(0).littleEndian) { Data($0) }))
        
        try writeOggPage(packets: [opusTags], isFirstPage: false, isLastPage: false, granulePos: 0)
        logger.info("Wrote OpusTags page")
    }
    
    func writeAudioPage(opusPackets: [Data], samplesInPage: UInt64) throws {
        granulePosition += samplesInPage
        try writeOggPage(packets: opusPackets, isFirstPage: false, isLastPage: false, granulePos: granulePosition)
    }
    
    func finalize() throws {
        // Write empty page to mark end of stream
        try writeOggPage(packets: [], isFirstPage: false, isLastPage: true, granulePos: granulePosition)
        logger.info("Finalized Ogg stream")
    }
    
    private func writeOggPage(packets: [Data], isFirstPage: Bool, isLastPage: Bool, granulePos: UInt64) throws {
        // Calculate total packet data size
        let totalPacketSize = packets.reduce(0) { $0 + $1.count }
        
        // Create segment table
        var segmentTable = Data()
        var lacingValues: [UInt8] = []
        
        for packet in packets {
            let size = packet.count
            let fullSegments = size / 255
            let remainder = size % 255
            
            // Add 255 for each full segment
            for _ in 0..<fullSegments {
                lacingValues.append(255)
            }
            // Add remainder (or 0 if packet is exactly divisible by 255)
            lacingValues.append(UInt8(remainder))
        }
        
        if packets.isEmpty {
            lacingValues = [0] // Empty page needs one zero-length segment
        }
        
        segmentTable.append(contentsOf: lacingValues)
        
        // Create Ogg page header
        var oggPage = Data()
        oggPage.append("OggS".data(using: .ascii)!) // Capture pattern
        oggPage.append(0) // Stream structure version
        
        // Header type flag
        var headerType: UInt8 = 0
        if isFirstPage { headerType |= 0x02 } // Beginning of stream
        if isLastPage { headerType |= 0x04 } // End of stream
        oggPage.append(headerType)
        
        oggPage.append(Data(withUnsafeBytes(of: granulePos.littleEndian) { Data($0) })) // Granule position
        oggPage.append(Data(withUnsafeBytes(of: streamSerialNumber.littleEndian) { Data($0) })) // Stream serial number
        oggPage.append(Data(withUnsafeBytes(of: sequenceNumber.littleEndian) { Data($0) })) // Page sequence number
        
        // CRC32 placeholder (will be calculated after header is complete)
        let crcPosition = oggPage.count
        oggPage.append(Data([0x00, 0x00, 0x00, 0x00]))
        
        oggPage.append(UInt8(lacingValues.count)) // Number of segments
        oggPage.append(segmentTable) // Segment table
        
        // Add packet data
        for packet in packets {
            oggPage.append(packet)
        }
        
        // Calculate and insert CRC32
        let crc = calculateCRC32(data: oggPage)
        oggPage.replaceSubrange(crcPosition..<(crcPosition + 4), with: Data(withUnsafeBytes(of: crc.littleEndian) { Data($0) }))
        
        // Write to file
        try fileHandle.write(contentsOf: oggPage)
        sequenceNumber += 1
    }
    
    private func calculateCRC32(data: Data) -> UInt32 {
        // Simple CRC32 implementation for Ogg
        let polynomial: UInt32 = 0x04C11DB7
        var crc: UInt32 = 0
        
        for byte in data {
            crc ^= UInt32(byte) << 24
            for _ in 0..<8 {
                if (crc & 0x80000000) != 0 {
                    crc = (crc << 1) ^ polynomial
                } else {
                    crc <<= 1
                }
            }
        }
        
        return crc
    }
}

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
    private var oggWriter: OggOpusWriter?
    private var isPaused = false
    private var frameBuffer: [Float] = []
    private let frameSize: Int = 960 // 20ms at 48kHz
    private var audioPacketsBuffer: [Data] = []
    private let packetsPerPage = 50 // Group packets into pages
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
        
        // Initialize Ogg Opus writer
        oggWriter = OggOpusWriter(fileHandle: outputFileHandle!)
        
        // Write Ogg Opus headers
        try oggWriter!.writeOpusHeadPage(channels: 1, inputSampleRate: 48000)
        try oggWriter!.writeOpusTagsPage()
        
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
        logger.info("Stopping Ogg Opus recording")
        
        // Flush any remaining audio data
        flushRemainingFrames()
        
        // Finalize Ogg stream
        do {
            try oggWriter?.finalize()
        } catch {
            logger.error("Error finalizing Ogg stream: \(error.localizedDescription)")
        }
        
        // Clean up
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        outputFileHandle?.closeFile()
        
        audioEngine = nil
        opusEncoder = nil
        outputFileHandle = nil
        oggWriter = nil
        
        logger.info("Ogg Opus recording stopped successfully")
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
              let oggWriter = oggWriter else { return }
        
        // Extract frame
        let frame = Array(frameBuffer.prefix(frameSize))
        frameBuffer.removeFirst(frameSize)
        
        // Encode frame
        let encodedData = try frame.withUnsafeBufferPointer { buffer in
            return try encoder.encode(pcmData: buffer.baseAddress!, frameSize: Int32(self.frameSize))
        }
        
        // Add to packet buffer
        audioPacketsBuffer.append(encodedData)
        
        // Write page when buffer is full
        if audioPacketsBuffer.count >= packetsPerPage {
            let samplesInPage = UInt64(audioPacketsBuffer.count * frameSize)
            try oggWriter.writeAudioPage(opusPackets: audioPacketsBuffer, samplesInPage: samplesInPage)
            audioPacketsBuffer.removeAll()
        }
    }
    
    private func flushRemainingFrames() {
        // Encode remaining complete frames
        while frameBuffer.count >= frameSize {
            do {
                try encodeFrame()
            } catch {
                print("Error flushing remaining frames: \(error)")
                break
            }
        }
        
        // Write any remaining packets in buffer
        if !audioPacketsBuffer.isEmpty {
            do {
                let samplesInPage = UInt64(audioPacketsBuffer.count * frameSize)
                try oggWriter?.writeAudioPage(opusPackets: audioPacketsBuffer, samplesInPage: samplesInPage)
                audioPacketsBuffer.removeAll()
            } catch {
                print("Error writing final audio page: \(error)")
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
    Granular Audio Capture v1.0.0 - Ogg Opus Edition
    
    Usage: audio-capture <action> [options]
    
    Actions:
        start       Start Ogg Opus-encoded microphone recording
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
    
    Output: Standard Ogg Opus files playable by VLC and other media players
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
            
            print("Ogg Opus recording started. Send SIGUSR1 to pause, SIGUSR2 to resume, SIGTERM to stop.")
            print("Process ID: \(ProcessInfo.processInfo.processIdentifier)")
            print("Output format: Standard Ogg Opus (.opus)")
            print("Target file size: ~240KB per minute at 32kbps")
            
            RunLoop.main.run()
            
        case .pause:
            print("Use kill -USR1 <process_id> to pause recording")
            
        case .resume:
            print("Use kill -USR2 <process_id> to resume recording")
            
        case .stop:
            print("Use kill -TERM <process_id> to stop recording")
            
        case .version:
            print("Granular Audio Capture v1.0.0 - Ogg Opus Edition")
            print("Standard Ogg Opus microphone recording utility")
            print("Target: 32kbps, ~240KB per minute")
            print("Output: Playable .opus files compatible with VLC and other players")
        }
    } catch {
        print("Error: \(error.localizedDescription)")
        exit(1)
    }
}

// MARK: - Application Entry Point
main()