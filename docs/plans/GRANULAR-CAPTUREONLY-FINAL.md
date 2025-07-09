# Granular CaptureOnly - Final Implementation Plan
*Revised based on senior developer feedback*

## Project Overview
Create an Electron application for capturing meeting data from Excel files and recording system audio during meetings with note-taking capabilities.

## Critical Design Decisions (Based on Feedback)

### 1. Folder Naming Convention
- **Original**: `YYYY-MM-DD-DayOfWeek`
- **Revised**: `YYYY-MM-DD` (simpler, no redundancy)
- **Rationale**: Day of week can be derived from date; simpler is better for file systems

### 2. Meeting Title Sanitization
- **Problem**: Meeting titles may contain illegal file system characters
- **Solution**: Implement slug generation for folder names
  - Convert to lowercase
  - Replace spaces with hyphens
  - Remove special characters (/\:*?"<>|)
  - Handle duplicates with counters (meeting-title-1, meeting-title-2)

### 3. Recording Control
- **Original**: Auto-start recording on notes page entry
- **Revised**: Recording starts by default but can be paused/stopped via the indicator
- **Rationale**: Users need control over recording state

### 4. Excel File Location
- **Original**: Automatically load Excel file (ambiguous location)
- **Revised**: 
  - First launch: Prompt user for file path
  - Store path in electron-store
  - Add menu option to change file path

## Revised File Organization Strategy

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

### Folder Name Generation Algorithm
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

## Revised Data Model

### Meeting Data Structure (Simplified)
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

## Technical Architecture Improvements

### Audio Recording Strategy
- **Stream to disk**: Write audio data every 5 seconds to prevent data loss
- **Crash recovery**: On app restart, check for incomplete recordings
- **Status monitoring**: Real-time audio level indicators

### Data Persistence
- Use `electron-store` for atomic writes
- Implement write-ahead logging for critical operations
- Regular auto-save for notes (every 30 seconds)

### Performance Optimization
- Asynchronous Excel parsing with progress indicator
- Use worker threads for large Excel files
- Lazy load meeting data (pagination for long lists)

## Revised Milestone Implementation

### Milestone 1: Excel Import & Meeting List Display
**Enhanced Features**:
- File path selection dialog on first launch
- Progress bar for Excel parsing
- Error handling for malformed Excel data
- Pagination for large meeting lists
- Settings menu for file path configuration

**Success Criteria**:
- [ ] File picker dialog works correctly
- [ ] Excel parsing is non-blocking
- [ ] Progress indicator shows during parsing
- [ ] Error messages are user-friendly
- [ ] Settings persist between sessions

### Milestone 2: Meeting Selection & Navigation
**Enhanced Features**:
- Meeting deduplication handling
- Folder creation with sanitized names
- Loading state during navigation
- Breadcrumb navigation

**Success Criteria**:
- [ ] Duplicate meetings handled gracefully
- [ ] Folder names are file-system safe
- [ ] Navigation state is preserved
- [ ] Back/forward navigation works

### Milestone 3: Notes Page Interface
**Enhanced Features**:
- Auto-save indicator
- Markdown preview toggle
- Participant validation (email format)
- Keyboard shortcuts (Cmd+S to save)
- Notes versioning

**Success Criteria**:
- [ ] Auto-save works reliably
- [ ] Markdown preview renders correctly
- [ ] Email validation provides feedback
- [ ] Keyboard shortcuts are responsive
- [ ] Previous versions can be recovered

### Milestone 4: Audio Recording with Control
**Enhanced Features**:
- Click indicator to pause/resume recording
- Audio level meter
- Recording duration display
- Stream to disk every 5 seconds
- Crash recovery for incomplete recordings

**Success Criteria**:
- [ ] Recording can be paused/resumed
- [ ] Audio levels visible in real-time
- [ ] Duration updates every second
- [ ] No data loss on crash
- [ ] Incomplete recordings are recoverable

### Milestone 5: File Attachment System
**Enhanced Features**:
- File type validation
- Size limit warnings (configurable)
- Thumbnail previews for images
- Batch file operations
- Duplicate file handling

**Success Criteria**:
- [ ] Invalid file types rejected with message
- [ ] Large files prompt for confirmation
- [ ] Image previews display correctly
- [ ] Multiple files can be managed at once
- [ ] Duplicate files renamed automatically

### Milestone 6: File Management & Persistence
**Enhanced Features**:
- Atomic file operations
- Transaction log for operations
- Cleanup of orphaned files
- Storage usage monitoring
- Export functionality

**Success Criteria**:
- [ ] File operations are atomic
- [ ] Failed operations can be rolled back
- [ ] Orphaned files detected and cleaned
- [ ] Storage usage displayed to user
- [ ] Meetings can be exported as ZIP

### Milestone 7: Resume Recording & History
**Enhanced Features**:
- Session timeline visualization
- Merge recordings option
- Recording session notes
- Quick resume from system tray
- Meeting search and filters

**Success Criteria**:
- [ ] Timeline shows all sessions clearly
- [ ] Recordings can be merged into one file
- [ ] Each session can have notes
- [ ] System tray provides quick access
- [ ] Search finds meetings by title/date/participant

## Risk Mitigation Strategies

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

### Cross-Platform Considerations
- Abstract file path operations
- Test on different macOS versions
- Handle different audio APIs gracefully
- Ensure UI scales properly

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

### User Acceptance Tests
- First-time user experience
- Recording control intuitiveness
- File organization clarity
- Error recovery workflows

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

### Usability Targets
- 3-click maximum for any operation
- Clear visual feedback for all actions
- Intuitive file organization
- Comprehensive error messages

## Conclusion

This final implementation plan incorporates all senior developer feedback to create a more robust, user-friendly, and maintainable application. Key improvements include:

1. **Simplified folder structure** with proper sanitization
2. **User control** over recording state
3. **Robust data model** without redundancy
4. **Performance optimizations** for scale
5. **Comprehensive error handling** and recovery

Each milestone now includes enhanced features that address potential edge cases and improve the overall user experience. The plan prioritizes data integrity, performance, and usability while maintaining the original vision of a simple, effective meeting capture tool.