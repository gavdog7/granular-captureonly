# Logging System Implementation Plan v3 (Battle Plan Edition)

## Context: The $500k Bet

**Objective**: Build a diagnostic logging system that enables a single developer to fix four critical bugs effectively and efficiently.

**Not Our Objective**: Build a production-grade logging system for enterprise SaaS. We're building a scalpel, not a Swiss Army knife.

**Timeline**: 2 days of surgical strikes, not 6 days of methodical file-by-file migration.

## What Changed from v2 → v3

Based on senior developer feedback, the plan has been radically simplified:

| Aspect | v2 (Over-Engineered) | v3 (Right-Sized) |
|--------|---------------------|------------------|
| **Log Files** | 2 files (main.log + renderer.log) | 1 file (app.log) |
| **Log Levels** | Multiple levels (debug/info/warn/error) with env switching | Single level (debug always on) |
| **Rotation** | 10MB with automatic rotation | 50MB single file, no rotation initially |
| **Migration** | File-by-file (all 626 console statements) | Flow-by-flow (only critical paths) |
| **Timeline** | 6 days | 2 days |
| **Analysis** | grep-focused | jq-first for queryable logs |
| **Scope** | Replace all console statements | Fix the 4 critical bugs, ignore the rest |

## The Four Critical Bugs (Unchanged)

These remain our PRIMARY OBJECTIVES:

1. **Audio Recording Failures** - Meetings sometimes don't record audio, especially when reopening meetings
2. **Silent Google Drive Upload Failures** - Uploads fail without visibility into the root cause
3. **Meeting Rename Issues** - Renaming meetings causes recording/upload failures due to path mismatches
4. **Upload Pipeline Audit Trail** - No visibility into timing from meeting end → Google Drive availability

## Simplified Architecture

### Single Unified Log File

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process                          │
│              (meeting-notes.js, etc.)                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼ IPC: 'log' channel
┌─────────────────────────────────────────────────────────────┐
│                    Main Process                              │
│              (main.js, services)                             │
│                  Unified Logger                              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
                    ┌──────────────────────┐
                    │ Single Log File      │
                    │ - logs/app.log       │
                    │   (max 50MB)         │
                    └──────────────────────┘
```

**Key Benefits:**
- **Chronological**: All events in a single timeline
- **Simple**: No timestamp correlation hell
- **Queryable**: grep + jq can answer questions, not just find strings

## Simplified Logger Implementation

### Logger Configuration (src/utils/logger.js)

```javascript
const log = require('electron-log');
const path = require('path');
const { app } = require('electron');

// ONE file. That's it.
log.transports.file.resolvePathFn = () => {
  return path.join(app.getPath('userData'), 'logs', 'app.log');
};

// Always debug level. Disk is cheap, time is not.
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';

// No rotation initially. Start with 50MB.
log.transports.file.maxSize = 50 * 1024 * 1024; // 50MB

// Format for structured logging + jq queries
log.transports.file.format = (msg) => {
  const { data, date, level } = msg;
  // First arg is the message, second is the structured payload
  const text = data.shift();
  const payload = data.length > 0 ? JSON.stringify(data[0]) : '';
  return `[${date.toISOString()}] [${level.toUpperCase()}] ${text} ${payload}`;
};

// Add process identifier for clarity
log.hooks.push((message, transport) => {
  if (transport === log.transports.file) {
    message.data.unshift(`[${process.type || 'main'}]`);
  }
  return message;
});

module.exports = log;
```

### IPC Bridge for Renderer Logging (main.js)

```javascript
const log = require('./utils/logger');
const { ipcMain } = require('electron');

// Simple IPC handler to receive logs from renderer
ipcMain.on('log', (event, level, message, data) => {
  log[level](message, data);
});
```

### Renderer Preload Script (preload.js)

```javascript
const { contextBridge, ipcRenderer } = require('electron');

// Expose logging to renderer
contextBridge.exposeInMainWorld('log', {
  debug: (message, data) => ipcRenderer.send('log', 'debug', message, data),
  info: (message, data) => ipcRenderer.send('log', 'info', message, data),
  warn: (message, data) => ipcRenderer.send('log', 'warn', message, data),
  error: (message, data) => ipcRenderer.send('log', 'error', message, data)
});
```

### Usage Pattern: Structured Logging

```javascript
// Main process
const log = require('./utils/logger');

log.info('[RECORDING] Session started', {
  meetingId: 123,
  sessionId: 'abc-123',
  filePath: '/path/to/file.opus',
  attempt: 1,
  timestamp: Date.now()
});

// Renderer process (via preload)
window.log.info('[PIPELINE] Navigation back initiated', {
  meetingId: 123,
  pipelineId: 'pipeline-123-1728480000',
  stage: 'T0-navigation-start',
  timestamp: Date.now()
});
```

## Critical Path Logging: The Four Flows

### Flow #1: Upload Pipeline (Issues #2 & #4)

**Files to Instrument:**
- `src/renderer/meeting-notes.js` (T0-T4 pipeline stages)
- `src/services/upload-service.js` (T5-T8 pipeline stages)
- `src/services/google-drive.js` (authentication)

**Key Log Points:**

```javascript
// T0: Navigation back (meeting-notes.js:1392)
const pipelineId = `pipeline-${meetingId}-${Date.now()}`;
const t0 = Date.now();

window.log.info('[PIPELINE] Navigation back initiated', {
  meetingId,
  pipelineId,
  stage: 'T0-navigation-start',
  timestamp: t0
});

// T1: Notes saved (meeting-notes.js:1400)
window.log.info('[PIPELINE] Notes saved', {
  meetingId,
  pipelineId,
  stage: 'T1-notes-saved',
  timestamp: Date.now(),
  duration: Date.now() - t0
});

// T2: Recording stopped (meeting-notes.js:1422)
window.log.info('[PIPELINE] Recording stopped', {
  meetingId,
  pipelineId,
  stage: 'T2-recording-stopped',
  timestamp: Date.now(),
  duration: Date.now() - t0
});

// T3: Markdown exported (meeting-notes.js:1446)
window.log.info('[PIPELINE] Markdown exported', {
  meetingId,
  pipelineId,
  stage: 'T3-markdown-exported',
  timestamp: Date.now(),
  duration: Date.now() - t0,
  filePath: exportResult.filePath
});

// T4: Upload queued (meeting-notes.js:1456)
window.log.info('[PIPELINE] Upload queued', {
  meetingId,
  pipelineId,
  stage: 'T4-upload-queued',
  timestamp: Date.now(),
  duration: Date.now() - t0
});

// T5: Queue processing (upload-service.js:65)
log.info('[PIPELINE] Queue processing started', {
  meetingId,
  pipelineId,
  stage: 'T5-queue-processing',
  timestamp: Date.now(),
  queueWaitTime: Date.now() - t4
});

// Authentication check (upload-service.js:150)
if (!this.googleDriveService.drive) {
  log.warn('[UPLOAD] Google Drive not authenticated', {
    meetingId,
    pipelineId,
    correlationId: `upload-${meetingId}-${Date.now()}`
  });

  try {
    await this.googleDriveService.initializeOAuth();
    log.info('[UPLOAD] Authentication successful', {
      meetingId,
      pipelineId
    });
  } catch (authError) {
    log.error('[UPLOAD] Authentication failed', {
      meetingId,
      pipelineId,
      error: authError.message,
      errorType: 'auth',
      requiresUserAction: true
    });
  }
}

// T6: Content validated (upload-service.js:147)
log.info('[PIPELINE] Content validated', {
  meetingId,
  pipelineId,
  stage: 'T6-content-validated',
  timestamp: Date.now(),
  notesFound: validation.notes.length,
  recordingsFound: validation.recordings.length,
  issues: validation.issues
});

// T7: Folders created (upload-service.js:160)
log.info('[PIPELINE] Google Drive folders created', {
  meetingId,
  pipelineId,
  stage: 'T7-folders-created',
  timestamp: Date.now(),
  folderId: meetingFolderId
});

// Individual file upload (upload-service.js:172)
const uploadStartTime = Date.now();
log.info('[UPLOAD] Uploading file', {
  meetingId,
  pipelineId,
  fileName: noteFile.name,
  filePath: noteFile.path,
  fileSize: stats.size,
  type: 'markdown',
  uploadStartTime
});

// Upload success/failure (upload-service.js:178-180)
if (success) {
  log.info('[UPLOAD] File uploaded successfully', {
    meetingId,
    pipelineId,
    fileName: noteFile.name,
    driveFileId: result.id,
    uploadDuration: Date.now() - uploadStartTime
  });
} else {
  log.error('[UPLOAD] File upload failed', {
    meetingId,
    pipelineId,
    fileName: noteFile.name,
    error: error.message,
    errorType: categorizeError(error), // 'auth', 'network', 'notfound', 'quota'
    willRetry: uploadItem.attempts < this.maxRetries
  });
}

// T8: Upload completed (upload-service.js:210)
log.info('[PIPELINE] Upload completed', {
  meetingId,
  pipelineId,
  stage: 'T8-upload-complete',
  timestamp: Date.now(),
  status: 'completed',
  filesUploaded: successfulUploads,
  filesFailed: uploadResults.failed.length,
  totalDuration: Date.now() - t0,
  breakdown: {
    t1_t0_notes: t1 - t0,
    t2_t1_recording: t2 - t1,
    t3_t2_markdown: t3 - t2,
    t4_t3_queue: t4 - t3,
    t5_t4_wait: t5 - t4,
    t6_t5_validate: t6 - t5,
    t7_t6_folders: t7 - t6,
    t8_t7_upload: t8 - t7
  }
});
```

**Helper: Error Categorization**

```javascript
// src/services/upload-service.js
function categorizeError(error) {
  if (error.message.includes('auth') || error.code === 401) return 'auth';
  if (error.message.includes('ENOENT') || error.code === 'ENOENT') return 'notfound';
  if (error.message.includes('quota') || error.code === 403) return 'quota';
  if (error.message.includes('network') || error.code === 'ECONNREFUSED') return 'network';
  return 'unknown';
}
```

### Flow #2: Recording Lifecycle (Issue #1)

**Files to Instrument:**
- `src/services/audio-recorder.js` (recording operations)
- `src/renderer/meeting-notes.js` (page lifecycle)

**Key Log Points:**

```javascript
// Meeting page opened (renderer/meeting-notes.js:716)
const viewId = `view-${Date.now()}`;
window.log.info('[RECORDING] Meeting page opened', {
  meetingId,
  viewId,
  timestamp: Date.now(),
  existingRecordingStatus: null // Will be populated if we query
});

// Recording start attempt (audio-recorder.js:41)
log.info('[RECORDING] Start attempt', {
  meetingId,
  sessionId: null, // Will be set after creation
  attempt,
  activeRecordings: this.activeRecordings.size,
  lastStopTime: this.lastStopTime,
  timeSinceLastStop: this.lastStopTime ? Date.now() - this.lastStopTime : null
});

// Audio session cleanup delay (audio-recorder.js:54-63)
const timeSinceLastStop = Date.now() - this.lastStopTime;
const minDelay = 1000;
if (timeSinceLastStop < minDelay) {
  const waitTime = minDelay - timeSinceLastStop;
  log.warn('[RECORDING] Audio session cleanup delay required', {
    meetingId,
    timeSinceLastStop,
    waitTime,
    reason: 'macOS audio session management'
  });
  await new Promise(resolve => setTimeout(resolve, waitTime));
}

// Session created (audio-recorder.js:86)
const sessionId = `session-${Date.now()}`;
log.info('[RECORDING] Session created', {
  meetingId,
  sessionId,
  finalPath,
  dirExists: await fs.pathExists(recordingDir),
  partNumber: recordingSession.partNumber
});

// Native process spawned (audio-recorder.js:481)
log.info('[RECORDING] Native process spawned', {
  meetingId,
  sessionId,
  pid: process.pid,
  command: `${binaryPath} start --output ${outputPath}`,
  timestamp: Date.now()
});

// Validation checkpoint (audio-recorder.js:526)
log.info('[RECORDING] Validation checkpoint', {
  meetingId,
  sessionId,
  fileSize: stats.size,
  expectedMinSize: 1024,
  passed: stats.size >= 1024,
  elapsedSeconds: 2
});

// Recording stopped (audio-recorder.js:290)
log.info('[RECORDING] Recording stopped', {
  meetingId,
  sessionId,
  duration: recording.duration,
  finalFileSize: stats?.size,
  finalPath: recording.finalPath,
  wasValidated: true,
  timestamp: Date.now()
});

// Meeting page closed (renderer/meeting-notes.js:204)
window.log.info('[RECORDING] Meeting page closed', {
  meetingId,
  viewId,
  recordingStopped: true,
  timestamp: Date.now()
});
```

### Flow #3: Meeting Rename (Issue #3)

**Files to Instrument:**
- `main.js` (IPC handlers)
- `src/services/file-manager.js` (filesystem operations)
- `src/services/database.js` (path updates)
- `src/services/upload-service.js` (path resolution)

**Key Log Points:**

```javascript
// Rename initiated (main.js:548)
log.info('[RENAME] Meeting rename initiated', {
  meetingId,
  oldTitle: folderInfo.title,
  newTitle: title,
  oldFolderName: folderInfo.folder_name,
  activeRecording: null // Check if recording is active
});

// Folder rename (file-manager.js:52)
log.info('[RENAME] Renaming folder on disk', {
  meetingId,
  oldPath: oldFolderPath,
  newPath: newFolderPath,
  filesInFolder: files.length
});

// Individual file rename (file-manager.js - in loop)
for (const file of files) {
  const oldFilePath = path.join(oldFolderPath, file);
  const newFilePath = path.join(newFolderPath, file);

  log.debug('[RENAME] Renaming file', {
    meetingId,
    oldFilePath,
    newFilePath,
    fileSize: stats.size
  });

  await fs.rename(oldFilePath, newFilePath);
}

// Database folder update (database.js:407)
log.info('[RENAME] Updating folder name in database', {
  meetingId,
  oldFolderName: folderInfo.folder_name,
  newFolderName: renameResult.newFolderName
});

// Recording paths update (database.js:421)
log.info('[RENAME] Updating recording paths', {
  meetingId,
  recordingsToUpdate: recordings.length,
  oldFolderName,
  newFolderName
});

recordings.forEach(recording => {
  const newPath = recording.final_path.replace(oldFolderName, newFolderName);
  log.debug('[RENAME] Updated recording path', {
    meetingId,
    recordingId: recording.id,
    oldPath: recording.final_path,
    newPath
  });
});

// Rename completed (main.js:576)
log.info('[RENAME] Rename operation completed', {
  meetingId,
  success: renameResult.success,
  newFolderName: renameResult.newFolderName,
  filesRenamed: renameResult.filesRenamed,
  duration: Date.now() - renameStartTime
});

// Path resolution during upload (upload-service.js:548-577)
log.debug('[RENAME] Resolving paths for upload', {
  meetingId,
  currentFolderName: meeting.folder_name,
  pathsToTry: possibleDirs.map(d => path.basename(d))
});

for (const dir of possibleDirs) {
  const exists = await fs.pathExists(dir);
  log.debug('[RENAME] Checking directory', {
    meetingId,
    dir,
    exists,
    filesFound: exists ? (await fs.readdir(dir)).length : 0
  });

  if (exists) {
    log.info('[RENAME] Path resolved successfully', {
      meetingId,
      resolvedPath: dir
    });
    break;
  }
}
```

## jq-First Diagnostic Queries

### Query #1: Find Slow Uploads (> 30 seconds)

```bash
cat logs/app.log | \
  grep "\[PIPELINE\]" | \
  jq -Rs 'split("\n") | map(select(length > 0) | capture("^.*?(?<json>\\{.*\\})$").json | fromjson) |
  group_by(.pipelineId) |
  map({
    pipelineId: .[0].pipelineId,
    meetingId: .[0].meetingId,
    totalTime: (map(select(.stage == "T8-upload-complete"))[0].totalDuration // 0),
    bottleneck: (map(select(.stage == "T8-upload-complete"))[0].breakdown | to_entries | max_by(.value))
  }) |
  map(select(.totalTime > 30000))'
```

**Output:**
```json
[
  {
    "pipelineId": "pipeline-123-1728480000",
    "meetingId": 123,
    "totalTime": 45000,
    "bottleneck": {
      "key": "t5_t4_wait",
      "value": 30000
    }
  }
]
```

### Query #2: Find Recording Failures (Audio Session Issues)

```bash
cat logs/app.log | \
  grep "\[RECORDING\]" | \
  jq -Rs 'split("\n") | map(select(length > 0) | capture("^.*?(?<json>\\{.*\\})$").json | fromjson) |
  map(select(.timeSinceLastStop != null and .timeSinceLastStop < 1000)) |
  .[] | {
    meetingId,
    timeSinceLastStop,
    waitTime,
    timestamp: .timestamp
  }'
```

**Output:**
```json
{
  "meetingId": 123,
  "timeSinceLastStop": 500,
  "waitTime": 500,
  "timestamp": 1728480123456
}
```

### Query #3: Trace Upload by Correlation ID

```bash
CORRELATION_ID="upload-123-1728480000"
cat logs/app.log | grep "$CORRELATION_ID" | \
  jq -Rs 'split("\n") | map(select(length > 0) | capture("^.*?(?<json>\\{.*\\})$").json | fromjson) |
  map({
    timestamp: .timestamp,
    stage: .stage,
    message: .message,
    error: .error // null
  })'
```

### Query #4: Identify Authentication Failures

```bash
cat logs/app.log | \
  grep "\[UPLOAD\]" | \
  grep "Authentication failed" | \
  jq -Rs 'split("\n") | map(select(length > 0) | capture("^.*?(?<json>\\{.*\\})$").json | fromjson) |
  .[] | {
    meetingId,
    pipelineId,
    error,
    requiresUserAction,
    timestamp: .timestamp
  }'
```

### Query #5: Rename Operation Audit

```bash
MEETING_ID=123
cat logs/app.log | \
  grep "\[RENAME\]" | \
  grep "meetingId\":$MEETING_ID" | \
  jq -Rs 'split("\n") | map(select(length > 0) | capture("^.*?(?<json>\\{.*\\})$").json | fromjson) |
  [{
    operation: "initiated",
    oldFolderName: .[0].oldFolderName,
    newFolderName: (map(select(.success != null))[0].newFolderName),
    filesRenamed: (map(select(.filesRenamed != null))[0].filesRenamed),
    success: (map(select(.success != null))[0].success),
    duration: (map(select(.duration != null))[0].duration)
  }]'
```

## The 2-Day Battle Plan

### Day 1: Upload & Timing (Issues #2 & #4)

**Morning (4 hours):**
1. ✓ Set up logger infrastructure
   - Create `src/utils/logger.js` with simplified config
   - Add IPC bridge in `main.js`
   - Update preload script
   - Test: Log from both processes, verify single log file
2. ✓ Instrument upload pipeline
   - Add all [PIPELINE] log points (T0-T8) to meeting-notes.js
   - Add all [UPLOAD] log points to upload-service.js
   - Add authentication logging to google-drive.js
   - Add error categorization helper

**Afternoon (4 hours):**
3. ✓ Test upload flow
   - Manually trigger upload
   - Run jq query to extract timing breakdown
   - Verify correlation ID tracking works
4. ✓ Test failure scenarios
   - Expire OAuth token, verify auth failure logged
   - Delete file, verify 'notfound' error logged
   - Disconnect network, verify 'network' error logged
5. ✓ Document jq queries for upload debugging

**Success Criteria (Day 1):**
- Can trace entire upload pipeline with single jq query
- Can identify bottleneck stage in < 1 minute
- Can categorize upload failure type immediately

### Day 2: Recording & Renaming (Issues #1 & #3)

**Morning (4 hours):**
1. ✓ Instrument recording lifecycle
   - Add all [RECORDING] log points to audio-recorder.js
   - Add page lifecycle logging to meeting-notes.js
   - Generate session IDs and view IDs
   - Log audio session cleanup timing
2. ✓ Instrument rename operations
   - Add [RENAME] log points to main.js IPC handler
   - Add filesystem logging to file-manager.js
   - Add database update logging to database.js
   - Add path resolution logging to upload-service.js

**Afternoon (4 hours):**
3. ✓ Test recording flow
   - Open meeting, close meeting, reopen immediately
   - Run jq query to find timeSinceLastStop < 1000ms
   - Verify validation checkpoint logging
4. ✓ Test rename flow
   - Rename meeting while recording
   - Verify filesystem and database updates logged
   - Upload after rename, verify path resolution logged
5. ✓ Document jq queries for recording/rename debugging

**Success Criteria (Day 2):**
- Can identify audio session cleanup issues in < 1 minute
- Can trace rename operation from filesystem to database to upload
- Can diagnose all four critical bugs from logs alone

### Optional: Day 3 (Polish)

If time permits:
1. Add "Open Logs Folder" to Help menu
2. Globally replace remaining console.log with log.debug (low-effort cleanup)
3. Add log viewer UI (bonus points)

## Migration Strategy: Flow-by-Flow

**NOT file-by-file.** We're not cleaning up 626 console statements. We're targeting the 4 critical code paths.

### Priority 1: Upload Pipeline
- `src/renderer/meeting-notes.js` (handleNavigationBack function only)
- `src/services/upload-service.js` (entire file)
- `src/services/google-drive.js` (authentication functions only)

### Priority 2: Recording & Rename
- `src/services/audio-recorder.js` (startRecording, stopRecording, validation)
- `src/renderer/meeting-notes.js` (initializeRecording, componentDidMount, componentWillUnmount)
- `main.js` (update-meeting-title IPC handler only)
- `src/services/file-manager.js` (renameNoteFolderAndFiles function only)
- `src/services/database.js` (updateMeetingFolderName, updateRecordingPaths)

### Ignore (For Now)
- All other console.log statements (500+ remaining)
- General error handling
- UI interaction logging
- Database query performance
- IPC handler execution time

**Rationale:** The bet is won when we can diagnose the 4 bugs. Everything else is noise.

## Troubleshooting Guides (jq Edition)

### Issue #1: Meeting Won't Record Audio

**Symptoms:** Recording indicator doesn't change, file size shows 0KB

**1-Minute Diagnosis:**
```bash
MEETING_ID=123

# Step 1: Check if audio session cleanup delay occurred
cat logs/app.log | \
  grep "\[RECORDING\]" | \
  grep "meetingId\":$MEETING_ID" | \
  jq -Rs 'split("\n") | map(select(length > 0) | capture("^.*?(?<json>\\{.*\\})$").json | fromjson) |
  map(select(.timeSinceLastStop != null and .timeSinceLastStop < 1000)) |
  length'

# If output > 0, root cause is rapid reopen

# Step 2: Check validation checkpoints
cat logs/app.log | \
  grep "\[RECORDING\]" | \
  grep "Validation checkpoint" | \
  grep "meetingId\":$MEETING_ID" | \
  jq -Rs 'split("\n") | map(select(length > 0) | capture("^.*?(?<json>\\{.*\\})$").json | fromjson) |
  .[] | {fileSize, passed}'

# If fileSize < 1024, audio capture failed
```

**Common Root Causes:**
- `timeSinceLastStop < 1000ms` → Reopened meeting too quickly
- `fileSize < 1024` after 2 seconds → Native process not capturing audio
- `pid` missing from "Native process spawned" → Binary failed to start

### Issue #2: Upload Silently Fails

**Symptoms:** Meeting shows "pending" status indefinitely

**30-Second Diagnosis:**
```bash
MEETING_ID=123

# Find the pipeline ID
PIPELINE_ID=$(cat logs/app.log | \
  grep "Navigation back initiated" | \
  grep "meetingId\":$MEETING_ID" | \
  tail -1 | \
  jq -r '.pipelineId')

# Trace the entire pipeline
cat logs/app.log | \
  grep "$PIPELINE_ID" | \
  jq -Rs 'split("\n") | map(select(length > 0) | capture("^.*?(?<json>\\{.*\\})$").json | fromjson) |
  map({stage: .stage, error: .error, errorType: .errorType}) |
  map(select(.error != null or .stage != null))'
```

**Common Root Causes:**
- `errorType: "auth"` → OAuth token expired, reconnect Google Drive
- `errorType: "notfound"` → Files missing, check path resolution
- `errorType: "network"` → Temporary connectivity issue
- `errorType: "quota"` → Google Drive storage full

### Issue #3: Rename Breaks Recording/Upload

**Symptoms:** After renaming, subsequent operations fail

**1-Minute Diagnosis:**
```bash
MEETING_ID=123

# Trace rename operation
cat logs/app.log | \
  grep "\[RENAME\]" | \
  grep "meetingId\":$MEETING_ID" | \
  jq -Rs 'split("\n") | map(select(length > 0) | capture("^.*?(?<json>\\{.*\\})$").json | fromjson) |
  [{
    oldFolderName: .[0].oldFolderName,
    newFolderName: (map(select(.newFolderName != null))[0].newFolderName),
    filesRenamed: (map(select(.filesRenamed != null))[0].filesRenamed),
    success: (map(select(.success != null))[0].success)
  }]'

# Check path resolution during upload
cat logs/app.log | \
  grep "\[RENAME\]" | \
  grep "Checking directory" | \
  grep "meetingId\":$MEETING_ID" | \
  jq -Rs 'split("\n") | map(select(length > 0) | capture("^.*?(?<json>\\{.*\\})$").json | fromjson) |
  .[] | {dir, exists, filesFound}'
```

**Common Root Causes:**
- `success: false` → Filesystem rename failed (permissions)
- `exists: false` for new folder → Files weren't moved
- `filesFound: 0` → Database has wrong path

### Issue #4: Slow Upload Pipeline

**Symptoms:** Long delay between ending meeting and files in Google Drive

**30-Second Diagnosis:**
```bash
MEETING_ID=123

# Find pipeline ID and extract bottleneck
cat logs/app.log | \
  grep "\[PIPELINE\]" | \
  grep "T8-upload-complete" | \
  grep "meetingId\":$MEETING_ID" | \
  tail -1 | \
  jq '{
    totalTime: .totalDuration,
    bottleneck: (.breakdown | to_entries | max_by(.value)),
    breakdown: .breakdown
  }'
```

**Output Example:**
```json
{
  "totalTime": 45000,
  "bottleneck": {
    "key": "t5_t4_wait",
    "value": 30000
  },
  "breakdown": {
    "t1_t0_notes": 150,
    "t2_t1_recording": 3200,
    "t3_t2_markdown": 400,
    "t4_t3_queue": 50,
    "t5_t4_wait": 30000,
    "t6_t5_validate": 200,
    "t7_t6_folders": 1200,
    "t8_t7_upload": 8500
  }
}
```

**Timing Benchmarks:**
- **Normal**: < 15 seconds total
- **Acceptable**: 15-30 seconds
- **Slow**: 30-60 seconds
- **Problem**: > 60 seconds

**Common Bottlenecks:**
- `t5_t4_wait` (queue wait) → Multiple meetings uploading, expected behavior
- `t2_t1_recording` (stop recording) → Audio process not responding
- `t7_t6_folders` (folder creation) → Google Drive API latency
- `t8_t7_upload` (file upload) → Large files or slow network

## Success Criteria (Unchanged)

### Critical Issue Resolution (MUST-HAVE)

**These criteria must be met to win the bet:**

1. **Issue #1 - Recording Failures**
   - ✓ Can identify audio session cleanup delays with single jq query
   - ✓ Can see validation checkpoint file sizes
   - ✓ Can correlate recording session with page view
   - ✓ **Diagnosis time: < 1 minute**

2. **Issue #2 - Silent Upload Failures**
   - ✓ Can trace complete upload pipeline with correlation ID
   - ✓ Can categorize failure type immediately (auth/network/notfound/quota)
   - ✓ Can see which files were found/missing
   - ✓ **Diagnosis time: < 30 seconds**

3. **Issue #3 - Rename Breaking Recording/Upload**
   - ✓ Can trace rename from filesystem to database to upload
   - ✓ Can verify path resolution attempts
   - ✓ Can identify orphaned files
   - ✓ **Diagnosis time: < 1 minute**

4. **Issue #4 - Upload Pipeline Timing Audit**
   - ✓ Can extract end-to-end timing breakdown with single jq query
   - ✓ Can identify bottleneck stage automatically
   - ✓ Can compare against benchmarks
   - ✓ **Diagnosis time: < 30 seconds**

### Functional Requirements

1. ✓ Single unified log file (app.log)
2. ✓ Logs from both main and renderer processes
3. ✓ Structured JSON payloads for jq queries
4. ✓ Correlation IDs for end-to-end tracing
5. ✓ Log prefixes ([RECORDING], [UPLOAD], [RENAME], [PIPELINE]) for filtering
6. ✓ Always debug level (no mode switching)
7. ✓ Timestamps in ISO 8601 format

### Quality Requirements

1. No performance degradation
2. Readable format for humans and machines
3. No sensitive data logged
4. Grep + jq can answer questions in < 1 minute
5. Zero log correlation hell (single chronological file)

## Risk Analysis & Mitigation

### 1. **IPC Logging Overhead**
**Risk:** Sending logs from renderer to main via IPC could slow down UI
**Mitigation:**
- IPC send is async, non-blocking
- Test with high-volume logging (100+ logs/second)
- If performance issue, fall back to separate renderer log file

### 2. **Log File Size Explosion**
**Risk:** Debug-level logging could create huge files quickly
**Mitigation:**
- 50MB is large enough for several days of usage
- Monitor file size in testing
- Can add rotation later if needed (premature optimization)

### 3. **jq Not Installed on User's Machine**
**Risk:** Diagnostic queries won't work for end users
**Mitigation:**
- Developer (you) will have jq installed
- For end users, provide "send logs to support" feature
- grep-only fallback queries also provided

### 4. **Structured Logging Format Breaking**
**Risk:** If log format changes, jq queries break
**Mitigation:**
- Lock down format in logger.js
- Test jq queries as part of implementation
- Version the log format if needed

### 5. **Missing Correlation IDs**
**Risk:** Pipeline tracing breaks if ID not passed correctly
**Mitigation:**
- Generate IDs at start of each flow
- Pass via function parameters and IPC
- Test end-to-end tracing explicitly

## Dependencies

```json
{
  "dependencies": {
    "electron-log": "^5.1.0"
  }
}
```

**System Requirements:**
- `jq` for diagnostic queries (install via `brew install jq` on macOS)

## Estimated Effort

- **Day 1**: Upload pipeline instrumentation + testing (8 hours)
- **Day 2**: Recording/rename instrumentation + testing (8 hours)
- **Total**: 2 days of focused development

**Not included in estimate:**
- Cleaning up the other 500+ console statements (deferred)
- Building log viewer UI (nice-to-have)
- Remote log upload feature (future enhancement)

## Summary: How v3 Wins the Bet

### The $500k Question: "Effective and Efficient"?

| Metric | v2 (Comprehensive) | v3 (Surgical) | Winner |
|--------|-------------------|---------------|---------|
| **Time to Value** | 6 days | 2 days | **v3** |
| **Complexity** | 2 log files, rotation, levels | 1 log file, always debug | **v3** |
| **Diagnosis Time** | ~5 minutes (grep) | < 1 minute (jq) | **v3** |
| **Scope** | All 626 console statements | Only 4 critical flows | **v3** |
| **Risk** | Moderate (big rewrite) | Low (targeted strikes) | **v3** |

### Key Innovations Over v2

1. **Single Log File** - Eliminates timestamp correlation hell
2. **IPC Bridge** - Renderer logs go through main process to unified file
3. **jq-First** - Logs are queryable, not just searchable
4. **Flow-by-Flow** - Attack value stream, not codebase file structure
5. **Always Debug** - No mode switching, just log everything
6. **2-Day Timeline** - Ruthlessly focused on the 4 bugs

### What We're NOT Doing (And Why)

| Feature | Why We're Skipping It |
|---------|----------------------|
| Log rotation | 50MB is plenty, add later if needed |
| Multiple log levels | Single developer, just log everything |
| Separate renderer logs | IPC bridge is simpler to debug |
| Migrating all console statements | Only need critical paths for diagnosis |
| Remote log upload | Direct filesystem access available |
| Log compression | Premature optimization |
| Performance metrics dashboard | Not required to fix the 4 bugs |

### The Bet-Winning Test

**Can we diagnose all 4 bugs from logs alone in < 5 minutes total?**

```bash
# Test 1: Recording failure (< 1 min)
cat logs/app.log | grep "\[RECORDING\]" | grep "meetingId\":123" | jq ...

# Test 2: Upload failure (< 30 sec)
cat logs/app.log | grep "pipeline-123" | jq ...

# Test 3: Rename issue (< 1 min)
cat logs/app.log | grep "\[RENAME\]" | grep "meetingId\":123" | jq ...

# Test 4: Pipeline timing (< 30 sec)
cat logs/app.log | grep "T8-upload-complete" | grep "meetingId\":123" | jq ...

# Total: < 3 minutes
```

**Result:** 2-day implementation, < 3-minute diagnosis, $500k won.

## References

- [electron-log Documentation](https://github.com/megahertz/electron-log)
- [jq Manual](https://stedolan.github.io/jq/manual/)
- [Structured Logging Best Practices](https://www.thoughtworks.com/insights/blog/structured-logging)
- [PADL Protocol](../CLAUDE.md) - Principled Agentic Development Lifecycle

---

**Version History:**
- v1: Initial plan
- v2: Comprehensive production-grade system (6 days)
- v3: Surgical strike for single developer (2 days) ← **Current**
