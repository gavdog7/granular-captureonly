# Participant Auto-Suggest Feature Implementation Plan

## Overview
Implement an auto-suggest feature for the participants input field that provides email suggestions based on frequency of occurrence in historical meeting data.

## Current State Analysis

### Existing Implementation
- **UI**: Simple inline email input that appears when clicking the "+" button
- **Data Source**: Participants are extracted from Excel files (`calendar*.xlsx`) during initial ingestion
- **Storage**: Participant emails stored as JSON arrays in SQLite database
- **Validation**: Basic email regex validation before adding

### Key Files
- `src/renderer/meeting-notes.html` - HTML structure for participants UI
- `src/renderer/meeting-notes.js` - JavaScript handling participant interactions
- `src/renderer/styles/meeting-notes.css` - Styling for participants section
- `src/database.js` - Database operations
- `src/meeting-loader.js` - Excel file parsing and email extraction

## Proposed Implementation

### 1. Backend Changes

#### A. Database Query for Participant Frequency
Create a new method in `database.js`:
```javascript
async getParticipantSuggestions(searchTerm = '') {
  // Query to get all participants with frequency count
  // Filter by searchTerm if provided
  // Order by frequency DESC
  // Return top 10 results
}
```

#### B. IPC Handler
Add to `main.js`:
```javascript
ipcMain.handle('get-participant-suggestions', async (event, searchTerm) => {
  return await db.getParticipantSuggestions(searchTerm);
});
```

### 2. Frontend Changes

#### A. HTML Structure
Modify `meeting-notes.html` to add dropdown container:
```html
<div id="participantInputPill" class="participant-input-pill">
  <input type="email" id="participantInput" placeholder="Enter email">
  <div id="participantSuggestions" class="participant-suggestions"></div>
</div>
```

#### B. JavaScript Implementation
Key functions to add/modify in `meeting-notes.js`:

1. **Debounced Input Handler**
   - Listen for input changes
   - Debounce API calls (300ms)
   - Fetch suggestions based on current input

2. **Suggestion Display**
   - Render dropdown with filtered suggestions
   - Highlight matching portions of email
   - Show frequency count as secondary info

3. **Keyboard Navigation**
   - Tab/Enter to select highlighted suggestion
   - Arrow keys to navigate suggestions
   - Escape to close dropdown

4. **Click Handling**
   - Click on suggestion to select
   - Click outside to close dropdown

### 3. CSS Styling
Add styles for suggestion dropdown:
- Positioned absolutely below input
- Match existing design language
- Hover states for suggestions
- Active/selected state styling

## Implementation Steps

1. **Phase 1: Backend Infrastructure**
   - Implement frequency query in database.js
   - Add IPC handler in main.js
   - Test with sample data

2. **Phase 2: Basic Autocomplete UI**
   - Add dropdown HTML structure
   - Implement input event listener
   - Display static suggestions

3. **Phase 3: Dynamic Suggestions**
   - Connect to backend API
   - Implement filtering logic
   - Add loading states

4. **Phase 4: Keyboard Navigation**
   - Tab completion
   - Arrow key navigation
   - Enter/Escape handling

5. **Phase 5: Polish**
   - Debouncing
   - Error handling
   - Performance optimization

## Risk Analysis & Mitigation

### 1. **Performance Issues**
**Risk**: Large participant lists could slow down queries
**Mitigation**: 
- Index participants data appropriately
- Limit suggestions to top 10
- Implement debouncing (300ms)
- Cache frequent queries in memory

### 2. **Email Privacy Concerns**
**Risk**: Exposing all email addresses in suggestions
**Mitigation**: 
- Only show emails that match current input
- Require minimum 2 characters before showing suggestions
- Consider permission levels if needed

### 3. **UI/UX Confusion**
**Risk**: Users might not understand how to use autocomplete
**Mitigation**: 
- Clear visual indicators (dropdown arrow)
- Placeholder text: "Start typing or press Tab"
- Consistent with common autocomplete patterns

### 4. **Data Quality Issues**
**Risk**: Malformed emails from spreadsheet parsing
**Mitigation**: 
- Validate emails before adding to suggestions
- Filter out obvious non-emails
- Deduplicate suggestions

### 5. **Edge Cases**
**Risk**: Multiple participants with similar emails
**Mitigation**: 
- Show full email in suggestions
- Secondary info (name if available)
- Clear visual separation between options

### 6. **Database Migration**
**Risk**: Existing data might not have proper structure
**Mitigation**: 
- Build frequency data on-the-fly initially
- Consider background job to pre-calculate
- Graceful fallback if no suggestions available

## Success Criteria

1. Typing 'g' shows emails starting with 'g' (e.g., gavin.edgley@databricks.com)
2. Suggestions ordered by frequency of appearance
3. Tab key selects top suggestion
4. Arrow keys navigate through options
5. No performance degradation with 1000+ unique emails
6. Works seamlessly with existing participant management

## Future Enhancements

1. **Smart Suggestions**
   - Suggest based on meeting title/type
   - Time-based patterns (e.g., weekly attendees)
   
2. **Name Resolution**
   - Show names alongside emails
   - Search by name or email

3. **Bulk Operations**
   - Add multiple participants at once
   - Import from clipboard

4. **Analytics**
   - Track suggestion usage
   - Improve ranking algorithm