# Audio Capture Binary

This Swift binary provides native macOS system audio recording capabilities for the Granular CaptureOnly application.

## Features

- System audio recording using AVFoundation
- 32kbps AAC/M4A output format
- Pause/resume functionality via signals
- Command-line interface for Electron integration
- macOS 13.0+ compatibility

## Building

```bash
cd src/native/audio-capture
swift build -c release
```

The compiled binary will be available at:
`.build/release/audio-capture`

## Usage

### Start Recording
```bash
./audio-capture start --output /path/to/recording.m4a --bitrate 32000
```

### Pause Recording
```bash
kill -USR1 <process_id>
```

### Resume Recording
```bash
kill -USR2 <process_id>
```

### Stop Recording
```bash
kill -TERM <process_id>
```

## Integration

The AudioRecorder class in `src/audio-recorder.js` manages this binary process:

1. Spawns the binary process for recording
2. Sends signals for pause/resume control
3. Manages file system operations in project assets folder
4. Handles crash recovery

## File Storage

Audio files are saved in the project's assets directory:
```
assets/YYYY-MM-DD/meeting-folder-name/recordings/recording-*.m4a
```

## Permissions

The app requires the following permissions in Info.plist:
- `NSMicrophoneUsageDescription`: For audio recording access
- `NSAudioCaptureUsageDescription`: For system audio capture (macOS 14.4+)

## Error Handling

The binary returns appropriate exit codes:
- 0: Success
- 1: General error (permissions, file system, etc.)
- 2: Invalid arguments

## Future Enhancements

- ScreenCaptureKit integration for macOS 13.0-14.3
- Hardware acceleration for encoding
- Multiple audio source selection
- Real-time audio level monitoring