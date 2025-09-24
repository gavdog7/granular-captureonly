# File Path Resolution Fix for Title Changes

## Problem
When a meeting title is changed, the folder rename process temporarily breaks file size monitoring, causing the indicator to show `--`.

## Root Cause
1. Title change triggers folder rename
2. Database paths are updated asynchronously
3. File monitoring fails during the brief transition window
4. `fs.stat()` fails on the old path before new path is available

## Proposed Solution: Enhanced Path Resolution

### Modify `get-file-growth-status` Handler

```javascript
ipcMain.handle('get-file-growth-status', async (event, meetingId) => {
  try {
    // Get meeting info to find file path
    const meeting = await database.getMeetingById(meetingId);
    if (!meeting) {
      return { exists: false, error: 'Meeting not found' };
    }

    // Get the most recent recording session
    const recordings = await database.all(
      'SELECT temp_path, final_path, completed FROM recording_sessions WHERE meeting_id = ? ORDER BY started_at DESC LIMIT 1',
      [meetingId]
    );

    if (recordings.length === 0) {
      return { exists: false, isActive: false };
    }

    const recording = recordings[0];
    const originalPath = recording.final_path || recording.temp_path;

    if (!originalPath) {
      return { exists: false, error: 'No file path available' };
    }

    // Try multiple path resolution strategies
    const pathsToTry = [
      originalPath, // Original database path
      await reconstructCurrentPath(meeting, originalPath), // Reconstructed current path
      await findFileInMeetingFolder(meeting) // Search in current meeting folder
    ].filter(path => path); // Remove null/undefined paths

    for (const filePath of pathsToTry) {
      try {
        const stats = await fs.stat(filePath);

        // If we found the file at a different path, update the database
        if (filePath !== originalPath) {
          await database.updateRecordingSessionPath(recording.id, filePath);
          console.log(`Updated recording path from ${originalPath} to ${filePath}`);
        }

        return {
          exists: true,
          isActive: true,
          size: stats.size,
          timestamp: Date.now(),
          path: filePath
        };
      } catch (error) {
        // File not found at this path, try next one
        continue;
      }
    }

    // No file found at any path
    return { exists: false, error: 'File not found at any expected location' };

  } catch (error) {
    return { exists: false, error: error.message };
  }
});

// Helper function to reconstruct current path based on current folder name
async function reconstructCurrentPath(meeting, originalPath) {
  if (!originalPath || !meeting.folder_name) return null;

  const path = require('path');
  const { getLocalDateString } = require('./utils/date-utils');

  // Extract filename from original path
  const fileName = path.basename(originalPath);

  // Reconstruct path with current folder name
  const assetsPath = path.join(__dirname, '..', 'assets');
  const dateStr = getLocalDateString(meeting.start_time);
  const currentPath = path.join(assetsPath, dateStr, meeting.folder_name, fileName);

  return currentPath;
}

// Helper function to search for recording file in current meeting folder
async function findFileInMeetingFolder(meeting) {
  try {
    const path = require('path');
    const fs = require('fs').promises;
    const { getLocalDateString } = require('./utils/date-utils');

    const assetsPath = path.join(__dirname, '..', 'assets');
    const dateStr = getLocalDateString(meeting.start_time);
    const folderPath = path.join(assetsPath, dateStr, meeting.folder_name);

    // List all .opus files in the folder
    const files = await fs.readdir(folderPath);
    const opusFiles = files.filter(file => file.endsWith('.opus'));

    if (opusFiles.length === 0) return null;

    // Return the most recently modified .opus file
    let newestFile = null;
    let newestTime = 0;

    for (const file of opusFiles) {
      const filePath = path.join(folderPath, file);
      const stats = await fs.stat(filePath);
      if (stats.mtime.getTime() > newestTime) {
        newestTime = stats.mtime.getTime();
        newestFile = filePath;
      }
    }

    return newestFile;
  } catch (error) {
    return null;
  }
}
```

### Alternative: Simpler Database Transaction Fix

If the above is too complex, we could make the title update atomic:

```javascript
// In update-meeting-title handler
await database.transaction(async (tx) => {
  await tx.updateMeetingTitle(meetingId, title);

  if (renameResult.success) {
    await tx.updateMeetingFolderName(meetingId, renameResult.newFolderName);
    await tx.updateRecordingPaths(meetingId, folderInfo.folder_name, renameResult.newFolderName);
  }
});
```

## Benefits of Enhanced Path Resolution

1. **Robust**: Handles file location during folder transitions
2. **Self-healing**: Automatically updates database with correct paths
3. **Fallback strategy**: Multiple ways to locate the file
4. **Transparent**: Users don't see the `--` flicker during renames
5. **Debug-friendly**: Logs when paths are corrected

## Implementation Priority

**High Priority** - This affects user experience and could mask real recording issues during the most common user action (changing meeting titles).