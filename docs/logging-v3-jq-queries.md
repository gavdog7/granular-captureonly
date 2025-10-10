# Logging System v3 - jq Query Reference

This document contains jq queries for testing and debugging the recording lifecycle and rename operations in the logging system v3.

## Prerequisites

Ensure `logs/app.log` exists with JSON-formatted log entries. Run the application and perform some recordings or rename operations to generate log data.

---

## Recording Flow Queries

### Query 1: Full Recording Session Lifecycle
Track a complete recording session from page open to recording stop.

```bash
cat logs/app.log | jq -c 'select(.msg | test("\\[RECORDING\\]")) | {time: .timestamp, msg: .msg, meetingId: .meetingId, sessionId: .sessionId, viewId: .viewId}'
```

**Expected Output**: Sequential events showing:
1. Meeting page opened (with viewId)
2. Start attempt (with timeSinceLastStop)
3. Session created (with sessionId)
4. Native process spawned
5. Validation checkpoint (fileSize, passed)
6. Recording stopped (duration, finalFileSize)
7. Meeting page closed

---

### Query 2: Check for Audio Session Cleanup Delays
Identify when macOS audio session management causes delays.

```bash
cat logs/app.log | jq -c 'select(.msg == "[RECORDING] Audio session cleanup delay required") | {meetingId: .meetingId, timeSinceLastStop: .timeSinceLastStop, waitTime: .waitTime, timestamp: .timestamp}'
```

**Expected Output**: Entries showing when <200ms gap between stop/start required a delay.

**Success Criteria**:
- Should appear when starting recording <200ms after stopping
- `timeSinceLastStop` should be < 200
- `waitTime` should show calculated delay

---

### Query 3: Validation Results
See which recordings passed/failed validation checkpoint.

```bash
cat logs/app.log | jq -c 'select(.msg == "[RECORDING] Validation checkpoint") | {meetingId: .meetingId, sessionId: .sessionId, fileSize: .fileSize, passed: .passed, timestamp: .timestamp}'
```

**Expected Output**: Validation checkpoints showing fileSize and pass/fail status.

**Success Criteria**:
- `passed: true` for files >= 1024 bytes
- `fileSize` should be reasonable for 2 seconds of audio

---

### Query 4: Recording Start Retry Detection
Identify when recording start requires multiple attempts.

```bash
cat logs/app.log | jq -c 'select(.msg == "[RECORDING] Start attempt") | {meetingId: .meetingId, attempt: .attempt, activeRecordings: .activeRecordings, timeSinceLastStop: .timeSinceLastStop, timestamp: .timestamp}'
```

**Expected Output**: Start attempts with attempt counter.

**Success Criteria**:
- `attempt: 1` for successful first attempts
- `attempt > 1` indicates retries (investigate cause)
- `activeRecordings` should be 0 at start

---

### Query 5: Correlate viewId Across Session
Track a specific meeting page session by viewId.

```bash
# Replace VIEW_ID with actual viewId from logs
cat logs/app.log | jq -c --arg vid "VIEW_ID" 'select(.viewId == $vid) | {time: .timestamp, msg: .msg, meetingId: .meetingId}'
```

**Expected Output**: All events for a single page view session.

---

### Query 6: Meeting Duration Analysis
Calculate time between page open and close.

```bash
cat logs/app.log | jq -s 'map(select(.msg | test("Meeting page (opened|closed)"))) | group_by(.meetingId) | map({meetingId: .[0].meetingId, opened: (map(select(.msg | test("opened"))) | .[0].timestamp), closed: (map(select(.msg | test("closed"))) | .[0].timestamp)}) | map(. + {duration: (.closed - .opened)})'
```

**Expected Output**: Meeting sessions with calculated duration.

---

## Rename Flow Queries

### Query 7: Full Rename Operation Lifecycle
Track a complete rename operation from initiation to completion.

```bash
cat logs/app.log | jq -c 'select(.msg | test("\\[RENAME\\]")) | {time: .timestamp, msg: .msg, meetingId: .meetingId, oldFolderName: .oldFolderName, newFolderName: .newFolderName, success: .success}'
```

**Expected Output**: Sequential events showing:
1. Rename initiated (oldTitle, newTitle, oldFolderName)
2. Renaming folder on disk (oldPath, newPath, filesInFolder)
3. Renaming file (oldFilePath, newFilePath)
4. Updating folder name in database
5. Updating recording paths (recordingsToUpdate)
6. Rename operation completed (success, duration)

---

### Query 8: Rename Operation Success Rate
Count successful vs. failed rename operations.

```bash
cat logs/app.log | jq -s 'map(select(.msg == "[RENAME] Rename operation completed")) | group_by(.success) | map({success: .[0].success, count: length})'
```

**Expected Output**: Counts of successful and failed renames.

**Success Criteria**: All renames should have `success: true`.

---

### Query 9: Rename Duration Analysis
Measure how long rename operations take.

```bash
cat logs/app.log | jq -c 'select(.msg == "[RENAME] Rename operation completed") | {meetingId: .meetingId, success: .success, duration: .duration, filesRenamed: .filesRenamed, timestamp: .timestamp}'
```

**Expected Output**: Rename durations in milliseconds.

**Success Criteria**: Durations should be < 1000ms for typical operations.

---

### Query 10: Database vs. Filesystem Rename Correlation
Ensure database updates follow filesystem changes.

```bash
cat logs/app.log | jq -c 'select(.msg | test("\\[RENAME\\] (Renaming folder on disk|Updating folder name in database)")) | {time: .timestamp, phase: .msg, meetingId: .meetingId, newFolderName: .newFolderName}'
```

**Expected Output**: Paired filesystem + database updates for each rename.

**Success Criteria**: Each "Renaming folder on disk" should be followed by "Updating folder name in database".

---

### Query 11: Path Resolution During Upload After Rename
Track how upload service resolves paths for renamed meetings.

```bash
cat logs/app.log | jq -c 'select(.msg | test("\\[RENAME\\] (Resolving paths|Checking directory)")) | {time: .timestamp, msg: .msg, meetingId: .meetingId, currentFolderName: .currentFolderName, pathsToTry: .pathsToTry, dir: .dir, exists: .exists, filesFound: .filesFound}'
```

**Expected Output**: Path resolution attempts showing which directories were checked.

**Success Criteria**:
- Should show multiple `pathsToTry` if old folder still exists
- Should find `exists: true` for at least one directory
- `filesFound` should match expected recording count

---

### Query 12: Recording Paths Update After Rename
Verify all recording paths are updated when a meeting is renamed.

```bash
cat logs/app.log | jq -c 'select(.msg | test("\\[RENAME\\] Updating recording path")) | {meetingId: .meetingId, recordingId: .recordingId, oldPath: .oldPath, newPath: .newPath, timestamp: .timestamp}'
```

**Expected Output**: Individual recording path updates.

**Success Criteria**: Number of path updates should match `recordingsToUpdate` count.

---

## Combined Workflow Queries

### Query 13: Record → Rename → Upload Pipeline
Track a meeting through the full lifecycle: record, rename, then upload.

```bash
cat logs/app.log | jq -c --arg mid "MEETING_ID" 'select(.meetingId == ($mid | tonumber)) | select(.msg | test("\\[(RECORDING|RENAME|PIPELINE)\\]")) | {time: .timestamp, phase: (.msg | capture("\\[(?<phase>[A-Z]+)\\]").phase), msg: .msg, sessionId: .sessionId, pipelineId: .pipelineId}'
```

**Expected Output**: Interleaved events from all three systems.

**Success Criteria**: Should see RECORDING → RENAME → PIPELINE sequence.

---

### Query 14: Error Detection Across All Systems
Find all errors and warnings in the log.

```bash
cat logs/app.log | jq -c 'select(.level == "error" or .level == "warn") | {time: .timestamp, level: .level, msg: .msg, meetingId: .meetingId, error: .error}'
```

**Expected Output**: All error/warning entries.

**Success Criteria**: Should be empty or only contain expected warnings (like audio cleanup delay).

---

### Query 15: Active Recording Overlap Detection
Detect if multiple recordings are accidentally running simultaneously.

```bash
cat logs/app.log | jq -c 'select(.msg == "[RECORDING] Start attempt") | {time: .timestamp, meetingId: .meetingId, activeRecordings: .activeRecordings, sessionId: .sessionId}'
```

**Expected Output**: Start attempts with active recording count.

**Success Criteria**: `activeRecordings` should always be 0 at start (no overlap).

---

## Usage Tips

1. **Filtering by Meeting**: Add `--arg mid "123"` and `select(.meetingId == ($mid | tonumber))` to any query
2. **Time Range**: Add `select(.timestamp >= START and .timestamp <= END)` to filter by time
3. **Pretty Print**: Remove `-c` flag for formatted JSON output
4. **Count Results**: Pipe to `| jq -s 'length'` to count matching entries
5. **Export Results**: Redirect to file with `> results.json`

---

## Testing Checklist

After running the application, verify:

- [ ] Recording flow queries return expected lifecycle events
- [ ] Rename flow queries show complete filesystem + database updates
- [ ] No unexpected errors or warnings appear
- [ ] Correlation IDs (viewId, sessionId, pipelineId) are present
- [ ] All timestamps are reasonable and sequential
- [ ] Path resolution queries show successful directory resolution
- [ ] Validation checkpoints show passing results

---

## Next Steps

1. Run the application and perform several recordings
2. Perform a rename operation on a meeting with recordings
3. Upload a renamed meeting to Google Drive
4. Run all queries above and verify expected output
5. Document any issues in BUGS.md with supporting jq query results
