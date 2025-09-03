# Orphaned Folder Bug Analysis & Fix

## Issue Summary
The "bavesh-gavin" folder from 9/3 was created with content but wasn't tracked in the database, preventing upload to Google Drive.

## Root Cause Analysis

### The Bug
There are **two different folder naming strategies** in the codebase that can create inconsistent folder names:

1. **MeetingLoader.sanitizeFolderName()** - Used when loading meetings from Excel
   - Location: `src/meeting-loader.js:397`
   - Creates: `2025-09-03-bavesh-gavin` (WITH date prefix)
   
2. **AudioRecorder.sanitizeFolderName()** - Used as fallback during recording
   - Location: `src/audio-recorder.js:415`  
   - Creates: `bavesh-gavin` (WITHOUT date prefix)

### Trigger Condition
In `src/audio-recorder.js:278`:
```javascript
const meetingFolder = meeting.folder_name || this.sanitizeFolderName(meeting.title);
```

If `meeting.folder_name` is null/empty, it falls back to AudioRecorder's sanitization method, which creates a folder name WITHOUT the date prefix.

### What Happened
1. Meeting was created in database with proper folder name: `2025-09-03-bavesh-gavin`
2. During recording, `meeting.folder_name` was somehow null/empty
3. AudioRecorder fallback created folder: `bavesh-gavin` (no date prefix)
4. Recording files went to wrong folder not tracked in database
5. Upload system couldn't find the meeting to sync

## Immediate Fix Applied
✅ Added orphaned meeting to database (ID 356)
✅ Linked existing recordings to the database entry  
✅ Added to upload queue for processing

## Recommended Permanent Fix
1. **Remove duplicate sanitization logic** - Use single source of truth
2. **Add validation** - Ensure folder_name is never null when recording starts
3. **Add monitoring** - Detect orphaned folders automatically

## Files Modified
- `src/upload-service.js` - Fixed auth failure handling
- Database - Added orphaned meeting entry
- `scripts/fix-orphaned-meeting.js` - One-time fix script

## Prevention
This bug could occur if:
- Database corruption causes folder_name to be null
- Concurrent access issues during meeting creation
- Excel reload happens while recording is active

The proper fix is to eliminate the fallback sanitization in AudioRecorder and ensure folder_name is always properly set.