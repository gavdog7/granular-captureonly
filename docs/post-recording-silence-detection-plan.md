# Post-Recording Silence Detection & File Splitting Plan

## Overview

Implement a post-recording analysis system that:
1. Analyzes completed recordings over 1 hour in duration
2. Detects extended silence periods indicating meeting end
3. Splits files into meeting content + silence portions
4. Preserves silence in `.silence` files to prevent processing
5. Updates database to reflect the split

## Architecture

### Trigger Points
- **When**: After recording session completes (`AudioRecorder.stopRecording()`)
- **Condition**: Recording duration > 1 hour (3600 seconds)
- **Process**: Asynchronous post-processing (non-blocking)

### File Structure After Processing
```
Original: recording-2025-09-18-23-11-25-497Z-session580.opus (1.7GB)
↓ (after processing)
Split into:
├── recording-2025-09-18-23-11-25-497Z-session580.opus (200MB - meeting only)
└── recording-2025-09-18-23-11-25-497Z-session580.silence (1.5GB - silence portion)
```

## Implementation Plan

### Phase 1: Post-Recording Analyzer

#### 1.1 Core Analysis Service
**File**: `src/post-recording-analyzer.js`

```javascript
class PostRecordingAnalyzer {
  constructor(database) {
    this.database = database;
    this.minDurationForAnalysis = 3600; // 1 hour
    this.silenceThreshold = -40; // dB
    this.minSilenceDuration = 600; // 10 minutes
  }

  async analyzeRecording(sessionId, filePath) {
    // 1. Check if recording meets criteria
    const metadata = await this.getAudioMetadata(filePath);
    if (metadata.duration < this.minDurationForAnalysis) {
      return { analyzed: false, reason: 'Under 1 hour duration' };
    }

    // 2. Quick analysis to detect silence pattern
    const silenceDetection = await this.detectExtendedSilence(filePath, metadata.duration);

    if (!silenceDetection.found) {
      return { analyzed: true, silenceDetected: false };
    }

    // 3. Split the file
    const splitResult = await this.splitRecording(filePath, silenceDetection.meetingEndTime);

    // 4. Update database
    await this.updateDatabaseAfterSplit(sessionId, splitResult);

    return {
      analyzed: true,
      silenceDetected: true,
      originalSize: splitResult.originalSize,
      meetingSize: splitResult.meetingSize,
      silenceSize: splitResult.silenceSize,
      meetingDuration: silenceDetection.meetingEndTime,
      totalSilenceDuration: metadata.duration - silenceDetection.meetingEndTime
    };
  }
}
```

#### 1.2 Integration with AudioRecorder
**File**: `src/audio-recorder.js` (modifications)

```javascript
// Add to AudioRecorder class
const PostRecordingAnalyzer = require('./post-recording-analyzer');

// In constructor
this.postAnalyzer = new PostRecordingAnalyzer(this.database);

// Modify stopRecording method
async stopRecording() {
  // ... existing stop recording logic ...

  // After successful recording completion
  if (recording.sessionId && recording.finalPath) {
    // Start post-processing asynchronously
    setImmediate(async () => {
      try {
        console.log(`🔍 Starting post-recording analysis for session ${recording.sessionId}`);
        const result = await this.postAnalyzer.analyzeRecording(
          recording.sessionId,
          recording.finalPath
        );

        if (result.silenceDetected) {
          console.log(`✂️ Recording split - Meeting: ${result.meetingDuration}s, Silence: ${result.totalSilenceDuration}s`);

          // Notify UI of the split
          this.mainWindow.webContents.send('recording-split', {
            sessionId: recording.sessionId,
            originalSize: result.originalSize,
            newSize: result.meetingSize,
            spaceSaved: result.silenceSize
          });
        }
      } catch (error) {
        console.error('❌ Post-recording analysis failed:', error);
      }
    });
  }

  // ... rest of existing logic ...
}
```

### Phase 2: File Splitting Logic

#### 2.1 Audio File Splitter
**File**: `src/audio-splitter.js`

```javascript
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class AudioSplitter {
  async splitAtTime(inputPath, splitTime, bufferSeconds = 120) {
    const dir = path.dirname(inputPath);
    const basename = path.basename(inputPath, '.opus');

    const meetingPath = path.join(dir, `${basename}.opus`);
    const silencePath = path.join(dir, `${basename}.silence`);
    const backupPath = path.join(dir, `${basename}_original.opus`);

    try {
      // 1. Create backup of original
      await fs.copyFile(inputPath, backupPath);

      // 2. Extract meeting portion (0 to splitTime + buffer)
      const meetingEndTime = splitTime + bufferSeconds;
      await this.extractSegment(inputPath, 0, meetingEndTime, meetingPath + '.tmp');

      // 3. Extract silence portion (splitTime to end)
      await this.extractSegment(inputPath, splitTime, null, silencePath);

      // 4. Replace original with meeting portion
      await fs.rename(meetingPath + '.tmp', meetingPath);

      // 5. Get file sizes
      const originalSize = (await fs.stat(backupPath)).size;
      const meetingSize = (await fs.stat(meetingPath)).size;
      const silenceSize = (await fs.stat(silencePath)).size;

      // 6. Remove backup if split was successful
      await fs.unlink(backupPath);

      return {
        success: true,
        meetingPath,
        silencePath,
        originalSize,
        meetingSize,
        silenceSize,
        compressionRatio: (originalSize - meetingSize) / originalSize
      };

    } catch (error) {
      // Restore from backup if something went wrong
      try {
        await fs.copyFile(backupPath, inputPath);
        await fs.unlink(backupPath);
      } catch (restoreError) {
        console.error('❌ Failed to restore backup:', restoreError);
      }
      throw error;
    }
  }

  extractSegment(inputPath, startTime, duration, outputPath) {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-ss', startTime.toString(),
        '-c', 'copy' // No re-encoding for speed
      ];

      if (duration !== null) {
        args.push('-t', duration.toString());
      }

      args.push(outputPath);

      const ffmpeg = spawn('ffmpeg', args, { stdio: 'pipe' });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed with code ${code}`));
        }
      });

      ffmpeg.on('error', reject);
    });
  }
}

module.exports = AudioSplitter;
```

### Phase 3: Database Schema Updates

#### 3.1 Database Modifications
**File**: `src/database.js` (additions)

```sql
-- Add new columns to recording_sessions table
ALTER TABLE recording_sessions ADD COLUMN was_split BOOLEAN DEFAULT 0;
ALTER TABLE recording_sessions ADD COLUMN original_duration REAL;
ALTER TABLE recording_sessions ADD COLUMN split_at_time REAL;
ALTER TABLE recording_sessions ADD COLUMN silence_file_path TEXT;
ALTER TABLE recording_sessions ADD COLUMN space_saved_bytes INTEGER;
```

```javascript
// Add new database methods

async recordSplit(sessionId, splitData) {
  const stmt = this.db.prepare(`
    UPDATE recording_sessions
    SET was_split = 1,
        original_duration = ?,
        split_at_time = ?,
        silence_file_path = ?,
        space_saved_bytes = ?
    WHERE id = ?
  `);

  return stmt.run(
    splitData.originalDuration,
    splitData.splitTime,
    splitData.silencePath,
    splitData.spaceSaved,
    sessionId
  );
}

async getSplitRecordings() {
  const stmt = this.db.prepare(`
    SELECT rs.*, m.title, m.started_at
    FROM recording_sessions rs
    JOIN meetings m ON rs.meeting_id = m.id
    WHERE rs.was_split = 1
    ORDER BY rs.started_at DESC
  `);

  return stmt.all();
}
```

### Phase 4: Prevent Processing of .silence Files

#### 4.1 File Processing Guards
**File**: Various processing modules

```javascript
// Add to any file processing logic
function shouldProcessFile(filePath) {
  // Skip .silence files
  if (filePath.endsWith('.silence')) {
    console.log(`⏭️ Skipping .silence file: ${path.basename(filePath)}`);
    return false;
  }
  return true;
}

// Example integration in transcription service
async processRecording(filePath) {
  if (!shouldProcessFile(filePath)) {
    return { skipped: true, reason: 'Silence file' };
  }

  // ... normal processing ...
}
```

#### 4.2 UI Indicators
**File**: `src/renderer/renderer.js`

```javascript
// Add UI elements to show split recordings
function displayRecording(recording) {
  const recordingElement = document.createElement('div');

  let statusIndicator = '';
  if (recording.was_split) {
    const spaceSavedMB = Math.round(recording.space_saved_bytes / (1024 * 1024));
    statusIndicator = `✂️ Split (${spaceSavedMB}MB saved)`;
  }

  recordingElement.innerHTML = `
    <div class="recording-item">
      <span class="recording-title">${recording.title}</span>
      <span class="recording-duration">${formatDuration(recording.duration)}</span>
      <span class="recording-status">${statusIndicator}</span>
    </div>
  `;

  return recordingElement;
}
```

### Phase 5: Configuration & Settings

#### 5.1 Configuration Options
**File**: `src/config.js`

```javascript
const postProcessingConfig = {
  enabled: true,
  minDurationForAnalysis: 3600, // 1 hour
  silenceThreshold: -40, // dB
  minSilenceDuration: 600, // 10 minutes
  bufferTime: 120, // 2 minutes buffer after meeting end
  keepSilenceFiles: true, // Set to false to delete silence files
  autoCleanupSilenceAfterDays: 30 // Delete .silence files after 30 days
};
```

#### 5.2 Settings UI
**File**: `src/renderer/settings.html`

```html
<div class="settings-section">
  <h3>Post-Recording Processing</h3>

  <label>
    <input type="checkbox" id="enable-post-processing" checked>
    Enable automatic silence detection for recordings over 1 hour
  </label>

  <div class="setting-group">
    <label>Silence threshold (dB):</label>
    <input type="range" id="silence-threshold" min="-50" max="-30" value="-40">
    <span id="threshold-value">-40 dB</span>
  </div>

  <div class="setting-group">
    <label>Minimum silence duration (minutes):</label>
    <input type="number" id="min-silence-duration" min="5" max="30" value="10">
  </div>
</div>
```

## Testing Strategy

### Test Cases

#### 4.1 Test Script
**File**: `scripts/test-post-processing.js`

```javascript
// Test with the all hands recording
async function testSplitting() {
  const analyzer = new PostRecordingAnalyzer(database);
  const testFile = './assets/2025-09-18/2025-09-18-all-hands/recording-2025-09-18-23-11-25-497Z-session580.opus';

  console.log('🧪 Testing post-recording analysis...');
  const result = await analyzer.analyzeRecording(580, testFile);

  console.log('Test Results:', result);

  // Verify files exist
  const meetingFile = testFile;
  const silenceFile = testFile.replace('.opus', '.silence');

  console.log('Meeting file exists:', await fs.access(meetingFile).then(() => true).catch(() => false));
  console.log('Silence file exists:', await fs.access(silenceFile).then(() => true).catch(() => false));
}
```

#### 4.2 Validation
- Test with recordings of various lengths (30min, 1.5hr, 3hr, 15hr)
- Verify split accuracy (meeting ends within 2 minutes of detected time)
- Confirm .silence files are not processed by other services
- Test file recovery in case of split failure

## Implementation Timeline

### Week 1:
1. ✅ Analysis complete
2. 🔄 Create PostRecordingAnalyzer class
3. 🔄 Implement AudioSplitter
4. 🔄 Database schema updates

### Week 2:
1. Integration with AudioRecorder
2. UI updates and notifications
3. Settings panel
4. Testing with existing large files

### Week 3:
1. Performance optimization
2. Error handling improvements
3. Documentation
4. Monitoring and logging

## Benefits

1. **Storage Savings**: 70-90% reduction for affected recordings
2. **Preservation**: Original audio preserved in .silence files
3. **Non-intrusive**: Only affects recordings over 1 hour
4. **Automatic**: No user intervention required
5. **Reversible**: Can reconstruct original if needed

## Risk Mitigation

1. **Backup Strategy**: Always create backup before splitting
2. **Atomic Operations**: Ensure split is all-or-nothing
3. **Validation**: Verify split accuracy before finalizing
4. **Recovery**: Ability to restore from .silence files if needed

---

This solution addresses your exact requirements: post-recording analysis for files over 1 hour, intelligent splitting, and preservation of silence data while preventing its processing.