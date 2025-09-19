# Meeting End Detection - Implementation Plan

## Problem Analysis

**Issue**: The app keeps recording long after meetings end, creating unnecessarily large files (1.7GB for 15-hour recording instead of ~200MB for 1-hour meeting).

**Root Cause**: No automatic detection when meetings end, leading to hours of silence being recorded.

## Audio Pattern Analysis Results

### All Hands Recording (2025-09-18) Analysis:
- **Total Duration**: 15.3 hours (55,205 seconds)
- **Actual Meeting Duration**: ~51 minutes (ended around 0.85 hours)
- **Wasted Recording**: 14.4 hours of silence

### Audio Level Patterns Discovered:
```
Time Period    | Audio Level | Status
0-51 minutes   | -34dB to -36dB | 🎙️ ACTIVE (meeting in progress)
51-53 minutes  | -36dB to -43dB | 🔄 TRANSITION (meeting ending)
53+ minutes    | -44dB to -60dB | 🔇 SILENCE (meeting ended)
```

### Detection Thresholds:
- **Active Meeting**: > -38dB average
- **Background/Silence**: < -40dB average
- **Transition Zone**: -38dB to -40dB (brief periods acceptable)
- **Sustained Silence**: 10+ minutes below -40dB = meeting ended

## Implementation Strategy

### Phase 1: Real-time Monitoring Integration

#### 1.1 Audio Recorder Enhancement
**File**: `src/audio-recorder.js`

Add meeting end detection to the existing AudioRecorder class:

```javascript
// Add to AudioRecorder constructor
this.meetingEndDetector = new MeetingEndDetector({
  silenceThreshold: -40,
  minSilenceDuration: 600, // 10 minutes
  sampleInterval: 30      // Check every 30 seconds
});

// Add to startRecording method
this.meetingEndDetector.startMonitoring(recording.finalPath, {
  onMeetingEndDetected: (data) => this.handleMeetingEnd(data)
});

// New method to handle automatic meeting end
async handleMeetingEnd(detectionData) {
  console.log('🏁 Meeting end detected, stopping recording...');

  // Stop current recording
  await this.stopRecording();

  // Update database with actual end time
  const actualEndTime = new Date(detectionData.estimatedMeetingEndTime);
  await this.database.updateMeetingEndTime(this.currentMeeting.id, actualEndTime);

  // Trim the recording to remove silence
  await this.trimRecording(detectionData);

  // Notify UI
  this.mainWindow.webContents.send('meeting-auto-ended', {
    meetingId: this.currentMeeting.id,
    detectionData
  });
}
```

#### 1.2 Database Schema Update
**File**: `src/database.js`

Add fields to track auto-detection:

```sql
ALTER TABLE meetings ADD COLUMN auto_ended_at TEXT;
ALTER TABLE meetings ADD COLUMN detection_confidence REAL;
ALTER TABLE recording_sessions ADD COLUMN original_duration INTEGER;
ALTER TABLE recording_sessions ADD COLUMN trimmed_duration INTEGER;
```

#### 1.3 User Interface Updates
**File**: `src/renderer/renderer.js`

Add UI indicators for auto-detection:
- Status indicator showing "Monitoring for meeting end..."
- Notification when meeting end is detected
- Option to override auto-detection
- Settings to configure detection sensitivity

### Phase 2: Recording Trimming

#### 2.1 Audio Processing Module
**File**: `src/audio-trimmer.js`

Create module to automatically trim recordings:

```javascript
class AudioTrimmer {
  async trimToMeetingEnd(recordingPath, meetingEndTime) {
    const outputPath = recordingPath.replace('.opus', '_trimmed.opus');

    // Use ffmpeg to trim to meeting end + 2 minute buffer
    const bufferTime = 120; // 2 minutes
    const trimEndTime = meetingEndTime + bufferTime;

    await this.runFFmpeg([
      '-i', recordingPath,
      '-t', trimEndTime.toString(),
      '-c', 'copy', // No re-encoding
      outputPath
    ]);

    // Replace original with trimmed version
    await fs.rename(outputPath, recordingPath);

    return {
      originalSize: await this.getFileSize(recordingPath + '.backup'),
      trimmedSize: await this.getFileSize(recordingPath),
      timeSaved: (originalDuration - trimEndTime) / 3600 // hours
    };
  }
}
```

### Phase 3: Configuration & Settings

#### 3.1 Settings Panel
**File**: `src/renderer/settings.js`

Add auto-detection settings:
- Enable/disable auto-detection
- Silence threshold slider (-30dB to -50dB)
- Minimum silence duration (5-30 minutes)
- Auto-trim recordings toggle

#### 3.2 Configuration Storage
**File**: `src/config.js`

```javascript
const defaultSettings = {
  autoDetection: {
    enabled: true,
    silenceThreshold: -40,
    minSilenceDuration: 600,
    sampleInterval: 30,
    autoTrim: true,
    bufferTime: 120
  }
};
```

### Phase 4: Testing & Validation

#### 4.1 Test Suite
**File**: `tests/meeting-end-detection.test.js`

Create comprehensive tests:
- Test with various meeting lengths
- Test with different silence patterns
- Test false positive prevention
- Test with background noise

#### 4.2 Validation Scripts
**File**: `scripts/validate-detection.js`

Script to test detection algorithm against historical recordings:
- Analyze existing large recordings
- Compare detected end times with actual
- Measure accuracy and false positive rates

## Implementation Priority

### High Priority (Week 1):
1. ✅ Audio analysis scripts (completed)
2. ✅ Detection algorithm (completed)
3. 🔄 Integration with AudioRecorder
4. 🔄 Basic UI notifications

### Medium Priority (Week 2):
1. Database schema updates
2. Recording trimming functionality
3. Settings panel
4. Error handling & edge cases

### Low Priority (Week 3):
1. Advanced configuration options
2. Historical recording analysis
3. Performance optimization
4. User documentation

## Risk Mitigation

### False Positives:
- **Risk**: Stopping recording during brief silence periods
- **Mitigation**: 10-minute minimum silence requirement + confidence scoring

### File Corruption:
- **Risk**: Issues during trimming process
- **Mitigation**: Create backup before trimming + atomic operations

### Performance Impact:
- **Risk**: Audio analysis affecting recording quality
- **Mitigation**: Low-frequency sampling (30s intervals) + background processing

## Success Metrics

1. **Storage Savings**: 70-90% reduction in file sizes for abandoned recordings
2. **Accuracy**: 95%+ correct detection of meeting ends
3. **False Positives**: <5% of legitimate meetings ended prematurely
4. **User Satisfaction**: User reports of "set and forget" reliability

## Technical Dependencies

- **FFmpeg**: For audio level analysis and trimming
- **Node.js**: Existing runtime environment
- **SQLite**: Database updates for tracking
- **Electron IPC**: UI notifications and settings

## File Changes Summary

### New Files:
- `scripts/meeting-end-detector.js` ✅
- `scripts/quick-audio-analysis.js` ✅
- `src/audio-trimmer.js`
- `tests/meeting-end-detection.test.js`
- `docs/meeting-end-detection-plan.md` ✅

### Modified Files:
- `src/audio-recorder.js` (add detection integration)
- `src/database.js` (schema updates)
- `src/renderer/renderer.js` (UI updates)
- `src/config.js` (settings)
- `package.json` (new dependencies if needed)

---

## Next Steps

1. **Immediate**: Integrate `MeetingEndDetector` into `AudioRecorder`
2. **This Week**: Implement basic auto-stop functionality
3. **Next Week**: Add trimming and UI improvements
4. **Testing**: Validate with historical recordings

This implementation will prevent future 15-hour recordings and save significant storage space while maintaining meeting recording reliability.