# Granular CaptureOnly - Implementation Plan

## Project Overview
Create an Electron application for capturing meeting data from Excel files and recording system audio during meetings with note-taking capabilities.

## Core Design Decisions

### 1. Folder Structure
- Daily folders: `YYYY-MM-DD`
- Meeting subfolders: Sanitized meeting titles

### 2. Meeting Title Sanitization
- Convert to lowercase
- Replace spaces with hyphens
- Remove special characters (/\:*?"<>|)
- Handle duplicates with counters (meeting-title-1, meeting-title-2)

### 3. Recording Control
- Recording starts automatically on notes page
- Click status indicator to pause/resume
- Recording stops when leaving notes page

### 4. Excel File Configuration
- First launch: File picker dialog
- Path stored in electron-store
- Menu option to change file location

## File Organization

### Assets Directory Structure
```
assets/
├── 2025-07-09/
│   ├── team-standup-1/
│   │   ├── recording-session-1.wav
│   │   ├── recording-session-2.wav
│   │   ├── notes.md
│   │   └── attachments/
│   │       ├── file1.pdf
│   │       └── file2.docx
│   └── client-meeting-1/
│       ├── recording-session-1.wav
│       ├── notes.md
│       └── attachments/
├── 2025-07-10/
│   └── product-review-1/
│       ├── recording-session-1.wav
│       └── notes.md
└── temp/
```

### Folder Name Generation
```javascript
function generateMeetingFolder(title, date, existingFolders) {
  // Sanitize title to create slug
  let slug = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-')     // Replace spaces with hyphens
    .replace(/-+/g, '-');     // Remove multiple hyphens
  
  // Handle empty slug
  if (!slug) slug = 'untitled-meeting';
  
  // Handle duplicates
  let finalName = slug;
  let counter = 1;
  while (existingFolders.includes(finalName)) {
    finalName = `${slug}-${counter}`;
    counter++;
  }
  
  return finalName;
}
```

## Data Model

### Meeting Data Structure
```javascript
{
  id: string,                    // UUID
  title: string,                 // Original title from Excel
  folderName: string,           // Sanitized folder name
  body: string,                 // Meeting description
  startDate: Date,
  endDate: Date,
  startTime: string,
  endTime: string,
  participants: string[],       // Editable list
  status: 'OWNER' | 'INVITED',
  notesFilePath: string,        // Path to single notes.md
  attachments: string[],        // Paths to attached files
  recordingSessions: [{
    sessionId: string,          // UUID for session
    timestamp: Date,
    recordingFile: string,      // Path to .wav file
    duration: number           // Recording duration in seconds
  }]
}
```

### Storage Configuration
```javascript
{
  excelFilePath: string,        // User-selected Excel file
  assetsDirectory: string,      // Default: ./assets
  autoStartRecording: boolean,  // Default: true
  streamingInterval: number     // Audio streaming interval (ms)
}
```

## Technical Architecture

### Audio Recording
- Stream audio to disk every 5 seconds
- Check for incomplete recordings on restart
- Display real-time audio levels

### Data Persistence
- Use `electron-store` for atomic writes
- Auto-save notes every 30 seconds
- Transaction logging for critical operations

### Performance
- Asynchronous Excel parsing
- Worker threads for large files
- Pagination for meeting lists

## Milestones

### Milestone 1: Excel Import & Meeting List Display
- File path selection dialog on first launch
- Progress bar for Excel parsing
- Error handling for malformed Excel data
- Pagination for large meeting lists
- Settings menu for file path configuration

### Milestone 2: Meeting Selection & Navigation
- Meeting deduplication handling
- Folder creation with sanitized names
- Loading state during navigation
- Breadcrumb navigation

### Milestone 3: Notes Page Interface
- Auto-save indicator
- Markdown preview toggle
- Participant validation (email format)
- Keyboard shortcuts (Cmd+S to save)
- Notes versioning

### Milestone 4: Audio Recording with Control
- Click indicator to pause/resume recording
- Audio level meter
- Recording duration display
- Stream to disk every 5 seconds
- Crash recovery for incomplete recordings

### Milestone 5: File Attachment System
- File type validation
- Size limit warnings (configurable)
- Thumbnail previews for images
- Batch file operations
- Duplicate file handling

### Milestone 6: File Management & Persistence
- Atomic file operations
- Transaction log for operations
- Cleanup of orphaned files
- Storage usage monitoring
- Export functionality

### Milestone 7: Resume Recording & History
- Session timeline visualization
- Merge recordings option
- Recording session notes
- Quick resume from system tray
- Meeting search and filters

## Risk Mitigation

### Data Corruption Prevention
- Use `electron-store` with atomic writes
- Implement write-ahead logging
- Regular backups of meeting metadata
- Validate data before writing

### Performance at Scale
- Implement virtual scrolling for meeting lists
- Use worker threads for Excel parsing
- Index meeting data for fast search
- Lazy load meeting details

### Audio Recording Reliability
- Stream to disk continuously
- Monitor system audio permissions
- Fallback to microphone if system audio fails
- Clear error messages for permission issues

## Testing Strategy

### Unit Tests
- Folder name sanitization
- Excel parsing edge cases
- Audio streaming logic
- Data model validation

### Integration Tests
- Full recording workflow
- File persistence across sessions
- Navigation state management
- Settings synchronization

### Performance Tests
- Large Excel file parsing
- Many concurrent recordings
- Storage usage optimization
- Memory leak detection

## Security Considerations

### File System Security
- Validate all file paths
- Prevent directory traversal
- Sanitize user inputs
- Limit file operation scope

### Data Privacy
- No network requests for user data
- Local storage only
- Optional encryption for sensitive notes
- Clear data deletion options

## Deployment Configuration

### Build Settings
```json
{
  "mac": {
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "entitlements.mac.plist",
    "entitlementsInherit": "entitlements.mac.plist",
    "category": "public.app-category.productivity",
    "minimumSystemVersion": "10.15"
  }
}
```

### Required Permissions
- Microphone access (fallback)
- System audio access (primary)
- File system access
- Optional: Accessibility (for global shortcuts)

## Success Metrics

### Performance Targets
- Excel parsing: < 2 seconds for 1000 meetings
- App launch: < 3 seconds
- Navigation: < 500ms between pages
- Auto-save: < 100ms

### Reliability Targets
- Zero data loss on crash
- 99.9% recording success rate
- Automatic error recovery
- Graceful degradation