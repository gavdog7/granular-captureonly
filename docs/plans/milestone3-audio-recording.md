# Milestone 3: System Audio Recording Implementation Plan

## Overview
Implement system audio recording functionality that automatically starts when entering meeting notes, provides pause/resume controls via status indicator, and manages recording sessions across page navigation.

## Requirements Analysis

### User Requirements
1. **Auto-start recording**: Recording begins automatically when user clicks on a meeting
2. **Status indicator control**: Recording status shown in top-right, clickable to pause/resume
3. **Auto-stop on exit**: Recording stops when user leaves notes page
4. **Session continuation**: New recording file with part number when returning to same meeting

### Technical Requirements
- macOS-only system audio capture
- 32kbps AAC/M4A encoding
- Crash recovery support
- Integration with existing UI/UX patterns
- Database session management

## Architecture Design

### Core Components

#### 1. Audio Recording Manager (`src/audio-recorder.js`)
**Purpose**: Main process audio recording coordination
**Responsibilities**:
- Manage Swift binary child process
- Handle recording session lifecycle
- File system operations for audio files
- Database integration for session tracking
- Permission management

#### 2. Native Swift Binary (`src/native/audio-capture/`)
**Purpose**: System audio capture using native macOS APIs
**Responsibilities**:
- CoreAudio API integration (macOS 14.4+)
- ScreenCaptureKit fallback (macOS 13.0-14.3)
- M4A encoding (AAC, 32kbps)
- Real-time audio processing
- Crash recovery mechanisms

#### 3. UI Integration (`src/renderer/meeting-notes.js`)
**Purpose**: Recording controls and status display
**Responsibilities**:
- Recording status indicator updates
- Auto-start/stop on page navigation
- Pause/resume control handling
- Real-time recording timer display

### System Flow

```
User clicks meeting → Navigate to notes page → Auto-start recording
                                                      ↓
                                            Create recording session
                                                      ↓
                                            Start Swift binary process
                                                      ↓
                                            Update UI status indicator
                                                      ↓
User clicks status → Pause/Resume recording ← → Update database
                                                      ↓
User leaves page → Stop recording → Finalize file → Update database
                                                      ↓
User returns → Start new recording session (part 2) → Continue...
```

## Implementation Plan

### Phase 1: Foundation Setup
1. **Create audio recording manager module**
   - File: `src/audio-recorder.js`
   - Basic class structure with session management
   - Database integration methods
   - IPC handler registration

2. **Add IPC handlers to main process**
   - `start-recording`: Initialize recording for meeting
   - `pause-recording`: Pause active recording
   - `resume-recording`: Resume paused recording
   - `stop-recording`: Stop and finalize recording
   - `get-recording-status`: Get current recording state

3. **Create Swift binary project structure**
   - Directory: `src/native/audio-capture/`
   - Swift Package Manager configuration
   - Basic audio capture skeleton

### Phase 2: Native Audio Capture
1. **Implement Swift audio capture binary**
   - CoreAudio integration for macOS 14.4+
   - ScreenCaptureKit fallback for macOS 13.0-14.3
   - M4A encoding with 32kbps AAC
   - Command-line interface for Electron integration

2. **Add permission handling**
   - Update Info.plist with NSAudioCaptureUsageDescription
   - Permission request flow
   - Graceful degradation for denied permissions

3. **File management system**
   - Temporary file handling during recording
   - Atomic file operations for crash recovery
   - Part number management for session continuation

### Phase 3: UI Integration
1. **Enhance recording status indicator**
   - Visual states: recording, paused, stopped, error
   - Click handler for pause/resume
   - Pulse animation for active recording
   - Tooltip with recording duration

2. **Auto-start/stop integration**
   - Hook into existing page navigation
   - Recording state persistence across refreshes
   - Error handling and user feedback

3. **Recording session display**
   - List of recording files in meeting notes
   - Playback controls (future enhancement)
   - File size and duration information

### Phase 4: Session Management
1. **Database operations**
   - Enhanced recording session tracking
   - Part number management
   - Crash recovery queries
   - Performance optimization

2. **File system integration**
   - Integration with existing asset management
   - Cleanup of temporary files
   - Storage quota management

3. **Error handling and recovery**
   - Crash recovery on app restart
   - Network interruption handling
   - Disk space management

### Phase 5: Testing and Polish
1. **Unit tests**
   - Audio recorder module tests
   - Database operation tests
   - File system operation tests

2. **Integration tests**
   - End-to-end recording workflow
   - Permission handling tests
   - Crash recovery tests

3. **Performance optimization**
   - Memory usage optimization
   - CPU usage monitoring
   - Battery impact assessment

## Technical Specifications

### File Naming Convention
```
recording-YYYYMMDD-HHMMSS-session{id}[-part{n}].m4a
```
Example: `recording-20250710-143022-session1-part2.m4a`

### Database Schema Extensions
```sql
-- Add columns to recording_sessions table
ALTER TABLE recording_sessions ADD COLUMN part_number INTEGER DEFAULT 1;
ALTER TABLE recording_sessions ADD COLUMN file_size INTEGER;
ALTER TABLE recording_sessions ADD COLUMN codec_info TEXT;
```

### IPC Message Format
```javascript
// Recording status object
{
  sessionId: number,
  isRecording: boolean,
  isPaused: boolean,
  duration: number, // seconds
  fileName: string,
  partNumber: number,
  error: string | null
}
```

### Swift Binary Interface
```bash
# Command-line interface
audio-capture start --output /path/to/file.m4a --bitrate 32000
audio-capture pause --session-id 123
audio-capture resume --session-id 123
audio-capture stop --session-id 123
```

## Error Handling Strategy

### Permission Errors
- Graceful degradation with clear user messaging
- Link to system preferences for permission management
- Fallback to manual recording instructions

### File System Errors
- Disk space checks before recording
- Temporary file cleanup on errors
- Atomic file operations to prevent corruption

### Process Errors
- Swift binary crash recovery
- Automatic restart with session restoration
- User notification of recording interruptions

## Performance Considerations

### Memory Usage
- Streaming audio processing (no large buffers)
- Automatic cleanup of completed sessions
- Configurable audio buffer sizes

### CPU Usage
- Efficient audio encoding (hardware acceleration where available)
- Background processing for non-critical operations
- Smart pause/resume to conserve resources

### Battery Impact
- Optimize for energy efficiency
- Suspend processing when not in use
- Monitor thermal state

## Security Considerations

### Privacy
- Local-only audio processing
- No network transmission of audio data
- Clear user consent for audio capture

### File Security
- Secure temporary file handling
- Proper file permissions
- Cleanup of sensitive data

## Future Enhancements

### Milestone 4 Integration
- Export recorded audio with notes
- Manifest generation including audio files
- Compression for archive creation

### Advanced Features
- Audio transcription integration
- Noise reduction/enhancement
- Multiple audio source selection
- Real-time audio level monitoring

## Success Criteria

### Functional Requirements
- [ ] Recording starts automatically on meeting page entry
- [ ] Status indicator shows recording state and responds to clicks
- [ ] Recording stops on page exit
- [ ] Session continuation creates new part files
- [ ] All recordings saved to database with metadata

### Performance Requirements
- [ ] Audio recording starts within 2 seconds
- [ ] CPU usage < 5% during recording
- [ ] Memory usage < 50MB additional
- [ ] File size approximately 240KB per minute (32kbps)

### Reliability Requirements
- [ ] Crash recovery restores recording state
- [ ] No data loss during app termination
- [ ] Graceful handling of permission denials
- [ ] Robust error reporting and user feedback

## Implementation Timeline

**Week 1**: Foundation Setup (Phase 1)
**Week 2**: Native Audio Capture (Phase 2)
**Week 3**: UI Integration (Phase 3)
**Week 4**: Session Management (Phase 4)
**Week 5**: Testing and Polish (Phase 5)

## Dependencies

### External Dependencies
- macOS 13.0+ (ScreenCaptureKit)
- macOS 14.4+ (CoreAudio enhancements)
- Swift 5.9+ for binary compilation
- Xcode Command Line Tools

### Internal Dependencies
- Existing database schema
- Current UI/UX patterns
- File system management utilities
- IPC communication framework

## Risk Assessment

### High Risk
- macOS permission system complexity
- Swift binary integration challenges
- Audio format compatibility issues

### Medium Risk
- Performance impact on older Macs
- Battery drain during long recordings
- File system space management

### Low Risk
- UI integration complexity
- Database schema changes
- IPC communication overhead

## Conclusion

This implementation plan provides a comprehensive approach to adding system audio recording to the Granular CaptureOnly application. The architecture leverages existing patterns while introducing robust native audio capture capabilities. The phased approach ensures steady progress with clear milestones and success criteria.