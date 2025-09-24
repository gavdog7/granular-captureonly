# Audio Debug Logging Implementation

## Overview

I've implemented a comprehensive verbose logging system for audio recording diagnostics controlled by environment variables. This will help isolate where the issue occurs when .opus files grow initially but end up silent and too small.

## Environment Variables Added

All debug flags are in `.env` (currently enabled) and `.env.example`:

```bash
AUDIO_DEBUG=true                # Master debug flag
AUDIO_DEBUG_PROCESS=true        # Log all process stdout/stderr
AUDIO_DEBUG_FILE_IO=true        # Log file I/O operations
AUDIO_DEBUG_VALIDATION=true     # Log recording validation checks
AUDIO_DEBUG_LIFECYCLE=true      # Log recording lifecycle events
```

## New Debug Components

### 1. Audio Debug Logger (`src/utils/audio-debug.js`)
**Purpose**: Centralized logging with timestamps and categorization

**Key Features**:
- Relative timestamps from session start
- Categorical logging (PROCESS, FILE I/O, VALIDATION, LIFECYCLE)
- Audio device enumeration on macOS
- File statistics logging with detailed analysis
- Recording validation with bitrate calculations
- Process output categorization
- Session summaries

### 2. Audio Diagnostics (`src/utils/audio-diagnostics.js`)
**Purpose**: Advanced diagnostic tools and validation

**Key Features**:
- Swift binary testing (`audio-capture version`)
- Audio device conflict detection
- Opus file integrity validation (if `opusinfo` available)
- System audio level monitoring (if `sox` available)
- Disk space checking
- Comprehensive pre-recording diagnostics

## What Gets Logged Now

### 1. Audio Input Device Validation ✅
- Available audio devices enumeration
- Current input device selection
- Microphone permission status checks
- Permission request results

### 2. Native Process Health Monitoring ✅
- Exact command line arguments logged
- ALL stdout/stderr from audio-capture process
- Process spawn/exit events with codes and signals
- Process error handling with stack traces
- Heartbeat monitoring through file growth

### 3. File I/O Verification ✅
- Directory creation logs
- File path generation
- File statistics (size, permissions, timestamps)
- File growth monitoring every 10 seconds
- Final file validation with size ratios
- Disk space availability

### 4. Opus Encoding Validation ✅
- Encoder configuration parameters
- File integrity checks (if tools available)
- Bitrate calculations and comparisons
- Duration validation

### 5. Recording Session Lifecycle ✅
- Session start/stop events
- State transitions (recording → paused → resumed → stopped)
- Database updates
- Retry logic with attempt tracking
- Error conditions and recovery

### 7. Data Flow Verification ✅
- Recording validation at 2-second mark
- File growth rate monitoring
- Expected vs actual size calculations
- Stagnant file detection (warns after 30s of no growth)
- Session summaries with compression ratios

## Integration Points

### AudioRecorder Class
- Pre-recording diagnostics run on first attempt
- All major methods now have debug logging
- File validation enhanced with detailed analysis
- Process monitoring includes all output

### Main Process (IPC Handlers)
- Microphone permission checks logged
- Pre-recording permission validation
- Error conditions tracked

## Key Diagnostic Capabilities

1. **Real-time File Growth**: Monitors every 10 seconds, detects stagnant files
2. **Binary Health**: Tests Swift binary before first recording
3. **Audio Session Conflicts**: Detects competing audio processes (macOS)
4. **Permission Validation**: Confirms microphone access at multiple points
5. **Opus Integrity**: Validates encoding if tools are available
6. **System Resource**: Monitors disk space and system state

## Usage

To enable full debugging:
```bash
# In .env file
AUDIO_DEBUG=true
AUDIO_DEBUG_PROCESS=true
AUDIO_DEBUG_FILE_IO=true
AUDIO_DEBUG_VALIDATION=true
AUDIO_DEBUG_LIFECYCLE=true
```

To disable:
```bash
AUDIO_DEBUG=false
# Other flags are ignored when master flag is false
```

## Log Output Examples

```
🎙️ [+2.045s] [LIFECYCLE] Starting recording for meeting 123 { attempt: 1, meetingId: 123 }
🎙️ [+2.120s] [PROCESS] Spawning audio capture process { binary: '/path/to/binary', args: [...] }
🎙️ [+4.200s] [VALIDATION] Initial file validation (2s) { size: 2048, expectedMinSize: 1024, passed: true }
🎙️ [+14.500s] [FILE I/O] File growth monitoring { currentSize: 15360, growthInLast10s: 4096, expectedGrowth: 4000, growthRate: '102.4%' }
```

This comprehensive logging will help identify exactly where the audio capture process is failing and why files end up silent despite appearing to grow.