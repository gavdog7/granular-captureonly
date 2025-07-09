# Milestone 2: Meeting Notes Interface - Implementation Plan

## Overview
Implementation of a comprehensive meeting notes interface with rich text editing, participant management, and attachment support.

## Technical Specifications

### Editor Framework: Quill
- **Version**: 2.0+ (TypeScript support)
- **Bundle Size**: Lightweight, fast performance (270ms load time)
- **Features**: Rich text editing with professional appearance
- **Proven**: Used by Slack, LinkedIn, Figma

### Page Structure & Navigation

#### Meeting Notes Page Layout
```
┌─────────────────────────────────────────────────────┐
│ [← Back]                    [●] [●] (Save/Recording) │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Meeting Details Section                         │ │
│ │ • Team Standup                                  │ │
│ │ • 9:00 AM - 9:30 AM                            │ │
│ │ • john@company.com, jane@company.com           │ │
│ │ • [Add Participant]                            │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │                                                 │ │
│ │         Quill Notes Editor                      │ │
│ │         (Rich text editing area)                │ │
│ │                                                 │ │
│ │         [Attachments integrated here]           │ │
│ │                                                 │ │
│ │                                                 │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

#### Navigation Flow
- **Meeting List** (existing) → **Meeting Notes Page** (new)
- Click on meeting → Navigate to `/meeting-notes.html?meetingId=123`
- Back button → Return to meeting list with smooth transition
- URL-based navigation for proper Electron routing

### Implementation Phases

#### Phase 1: Page Structure & Navigation
1. Create `meeting-notes.html` page
2. Add IPC handlers for meeting details retrieval
3. Implement navigation from meeting list to notes page
4. Add back button functionality
5. Style meeting details section

#### Phase 2: Quill Editor Integration
1. Add Quill to package.json dependencies
2. Initialize Quill editor on notes page
3. Configure Quill with appropriate toolbar options
4. Style editor to match app design
5. Implement focus management

#### Phase 3: Auto-save System
1. Implement 3-second debounced auto-save
2. Add save status indicator (colored circle in top right)
3. Handle offline/connection issues gracefully
4. Persist to `meetings.notes_content` via IPC

#### Phase 4: Participant Management
1. Display current participants from database
2. Add participant input with email validation
3. Remove participant functionality
4. Sync changes to `meetings.participants` JSON field
5. Visual feedback for participant changes

#### Phase 5: Attachment System
1. Create drag & drop zone integrated within editor
2. File upload handling and validation
3. Store files in `assets/[date]/[meeting-folder]/attachments/`
4. Database tracking via `attachments` table
5. Display uploaded files with download/remove options

#### Phase 6: Status Indicators & Polish
1. Recording status indicator (colored circle in top right)
2. Loading states and error handling
3. Keyboard shortcuts (Cmd+S, Cmd+B for bold, Cmd+I for italic, Tab for indent)
4. Smooth page transitions
5. Meeting status indicators (ongoing, past, etc.)

### Technical Configuration

#### Quill Configuration
```javascript
const quill = new Quill('#editor', {
  theme: 'snow',
  modules: {
    toolbar: [
      ['bold', 'italic', 'underline'],
      ['blockquote', 'code-block'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'indent': '-1'}, { 'indent': '+1' }],
      ['link'],
      ['clean']
    ],
    keyboard: {
      bindings: {
        'bold': { key: 'B', ctrlKey: true },
        'italic': { key: 'I', ctrlKey: true },
        'tab': { key: 'Tab', handler: () => quill.format('indent', '+1') }
      }
    }
  },
  placeholder: 'Start typing your meeting notes...'
});
```

#### Auto-save Implementation
```javascript
let saveTimeout;
quill.on('text-change', () => {
  clearTimeout(saveTimeout);
  showSaveIndicator('saving');
  saveTimeout = setTimeout(() => {
    saveNotes();
  }, 3000);
});
```

#### File Structure Changes
```
src/renderer/
├── index.html              # Meeting list (existing)
├── meeting-notes.html      # New meeting notes page
├── renderer.js             # Meeting list JS (existing)
├── meeting-notes.js        # New meeting notes JS
└── styles/
    ├── main.css           # Shared styles (existing)
    └── meeting-notes.css  # Meeting notes specific styles
```

### Database Integration
- **Notes**: Use existing `meetings.notes_content` field
- **Participants**: Use existing `meetings.participants` JSON field
- **Attachments**: Use existing `attachments` table
- **Auto-save**: Call existing `updateMeetingNotes` IPC handler

### Features

#### Status Indicators (Top Right)
- **Save Status**: 
  - Green circle: Saved
  - Yellow circle: Saving...
  - Red circle: Error
- **Recording Status**:
  - Red circle: Recording active
  - Gray circle: Not recording

#### Keyboard Shortcuts
- **Cmd+B**: Bold
- **Cmd+I**: Italic
- **Tab**: Indent
- **Shift+Tab**: Outdent
- **Cmd+S**: Manual save
- **Cmd+← or Escape**: Back to meeting list

#### Attachment Integration
- Drag & drop files directly into editor
- Attachments appear as inline elements within text
- Click to download/remove attachments
- Support for all file types

#### Smooth Transitions
- Fade in/out between pages
- Loading states for editor initialization
- Smooth save indicator animations

### Success Criteria
- ✅ Seamless navigation between meeting list and notes
- ✅ Rich text editing with all expected keyboard shortcuts
- ✅ Auto-save every 3 seconds with visual feedback
- ✅ Participant management with email validation
- ✅ Drag & drop file attachments within editor
- ✅ Recording status indicator for future recording feature
- ✅ Professional, native-feeling interface

### Next Steps
After Milestone 2 completion, this interface will be ready for:
- **Milestone 3**: System audio recording integration
- **Milestone 4**: Export functionality (.md file generation)
- **Milestone 5**: Google Drive automation