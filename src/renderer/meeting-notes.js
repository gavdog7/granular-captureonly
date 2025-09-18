// Meeting Notes Page JavaScript
console.log('meeting-notes.js script loading...');
const { ipcRenderer } = require('electron');
console.log('ipcRenderer loaded successfully');

let quill;
let currentMeetingId;
let saveTimeout;
let isLoading = true;
let recordingStatusInterval;
let currentRecordingStatus = null;
let initialNotesContent = null; // Track initial notes content for change detection
let selectedSuggestionIndex = -1;
let currentSuggestions = [];
let suggestionTimeout;

// File growth monitoring state
let fileGrowthInterval;
let previousFileSize = 0;
let previousCheckTime = 0;
let fileGrowthHistory = []; // Track last 3 checks

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Meeting notes page loading...');
    console.log('📍 Current URL:', window.location.href);
    
    // Get meeting ID from URL params
    const urlParams = new URLSearchParams(window.location.search);
    currentMeetingId = urlParams.get('meetingId');
    
    console.log('🆔 Meeting ID from URL:', currentMeetingId);
    console.log('🔗 URL search params:', window.location.search);
    
    if (!currentMeetingId) {
        console.error('No meeting ID provided');
        window.location.href = 'index.html';
        return;
    }
    
    console.log('🔧 Initializing components...');
    
    // Initialize components
    try {
        initializeQuillEditor();
        console.log('✅ Quill editor initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Quill editor:', error);
        return;
    }
    
    try {
        initializeEventListeners();
        console.log('✅ Event listeners initialized');
    } catch (error) {
        console.error('❌ Failed to initialize event listeners:', error);
        return;
    }
    
    try {
        await loadMeetingData();
        console.log('✅ Meeting data loaded');
    } catch (error) {
        console.error('❌ Failed to load meeting data:', error);
        hideLoadingOverlay();
        return;
    }
    
    // Initialize recording functionality
    await initializeRecording();
    console.log('Recording initialized');
    
    // Initialize markdown export manager (temporarily disabled to fix loading issue)
    // if (window.markdownExportManager) {
    //     window.markdownExportManager.initialize(currentMeetingId);
    //     console.log('Markdown export manager initialized');
    // }
    
    // Hide loading overlay
    hideLoadingOverlay();
    console.log('Page initialization complete');
});

// Initialize Quill editor with custom configuration
function initializeQuillEditor() {
    console.log('Initializing Quill editor...');
    
    if (typeof Quill === 'undefined') {
        console.error('Quill is not loaded!');
        return;
    }
    
    const editorElement = document.getElementById('editor');
    if (!editorElement) {
        console.error('Editor element not found!');
        return;
    }
    
    const toolbarOptions = [
        ['bold', 'italic', 'underline'],
        ['blockquote', 'code-block'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        ['link'],
        ['clean']
    ];
    
    console.log('Creating Quill instance...');
    quill = new Quill('#editor', {
        theme: 'snow',
        modules: {
            toolbar: toolbarOptions,
            keyboard: {
                bindings: {
                    'bold': {
                        key: 'B',
                        ctrlKey: true,
                        handler: function() {
                            this.quill.format('bold', !this.quill.getFormat().bold);
                        }
                    },
                    'italic': {
                        key: 'I',
                        ctrlKey: true,
                        handler: function() {
                            this.quill.format('italic', !this.quill.getFormat().italic);
                        }
                    },
                    'tab': {
                        key: 'Tab',
                        handler: function(range) {
                            this.quill.format('indent', '+1');
                            return false;
                        }
                    },
                    'shift-tab': {
                        key: 'Tab',
                        shiftKey: true,
                        handler: function(range) {
                            this.quill.format('indent', '-1');
                            return false;
                        }
                    },
                    'save': {
                        key: 'S',
                        ctrlKey: true,
                        handler: function() {
                            saveNotes();
                            return false;
                        }
                    }
                }
            }
        },
        placeholder: 'Write notes...'
    });
    
    // Set up auto-save on text change
    quill.on('text-change', (delta, oldDelta, source) => {
        console.log('Text change detected:', { delta, source, isLoading });
        if (source === 'user' && !isLoading) {
            console.log('User text change - setting save status and scheduling auto-save');
            setSaveStatus('saving'); // Immediately show saving status
            scheduleAutoSave();
        }
    });
    
    // Set up drag and drop for attachments
    setupDragAndDrop();
}

// Initialize event listeners
function initializeEventListeners() {
    // Back button - wait for save before navigating
    const backButton = document.getElementById('backButton');
    console.log('🔗 Setting up back button listener, element found:', !!backButton);
    
    if (backButton) {
        backButton.addEventListener('click', (e) => {
            console.log('🖱️ Back button clicked!');
            e.preventDefault(); // Prevent default navigation immediately
            e.stopPropagation(); // Stop event bubbling
            
            // Run async handler without blocking preventDefault
            handleNavigationBack().catch(error => {
                console.error('Error in navigation handler:', error);
                // Still navigate even if handler fails
                window.location.href = 'index.html';
            });
        });
    } else {
        console.error('❌ Back button element not found!');
    }
    
    // Escape key to go back - wait for save before navigating
    document.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') {
            console.log('⌨️ Escape key pressed!');
            e.preventDefault(); // Prevent default behavior
            await handleNavigationBack();
        }
    });
    
    // Save before page unload and stop recording
    window.addEventListener('beforeunload', (e) => {
        // Stop recording status updates
        stopRecordingStatusUpdates();

        // Stop file growth monitoring
        stopFileGrowthMonitoring();
        
        // Stop recording if active
        if (currentRecordingStatus && currentRecordingStatus.isRecording) {
            console.log('Page unloading, stopping recording');
            try {
                // Validate meeting ID before stopping recording
                const meetingId = parseInt(currentMeetingId);
                if (isNaN(meetingId)) {
                    console.log('Skipping recording stop for non-numeric meeting ID:', currentMeetingId);
                } else {
                    // Use synchronous IPC to stop recording before page unload
                    ipcRenderer.sendSync('stop-recording-sync', meetingId);
                    console.log('Recording stopped synchronously');
                }
            } catch (error) {
                console.error('Error stopping recording synchronously:', error);
            }
        }
        
        // Update meeting duration synchronously
        try {
            console.log('Page unloading, updating meeting duration');
            
            // Validate meeting ID before sending to main process
            const meetingId = parseInt(currentMeetingId);
            if (isNaN(meetingId)) {
                console.log('Skipping duration update for non-numeric meeting ID:', currentMeetingId);
                return;
            }
            
            ipcRenderer.sendSync('update-meeting-duration-sync', meetingId);
            console.log('Meeting duration updated synchronously');
        } catch (error) {
            console.error('Error updating duration synchronously:', error);
        }
        
        // Save notes
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            console.log('Page unloading, forcing immediate save');
            // Force an immediate synchronous save
            try {
                const content = quill.getContents();
                const contentStr = JSON.stringify(content);
                // Use sendSync for synchronous save before page unload
                ipcRenderer.sendSync('update-meeting-notes-sync', currentMeetingId, contentStr);
                console.log('Synchronous save completed');
                // Update initial content even in sync save
                initialNotesContent = contentStr;
            } catch (error) {
                console.error('Error in synchronous save:', error);
            }
        }
        
        // Note: We don't export markdown on beforeunload because:
        // 1. It would need to be synchronous which could block the page
        // 2. The user might be refreshing or navigating elsewhere
        // 3. We only export when explicitly going back to nav page
    });
    
    // Save on focus loss
    window.addEventListener('blur', async () => {
        await ensureNotesAreSaved();
    });
    
    
    // Edit title functionality - click title to edit
    document.getElementById('meetingTitle').addEventListener('click', startEditingTitle);
    document.getElementById('meetingTitleInput').addEventListener('blur', saveTitle);
    document.getElementById('meetingTitleInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveTitle();
        }
        if (e.key === 'Escape') {
            cancelEditTitle();
        }
    });
    
    // New inline participant functionality
    document.getElementById('addParticipantBtn').addEventListener('click', showInlineParticipantInput);
    
    // Click to toggle participants list
    document.getElementById('participantsPill').addEventListener('click', toggleParticipantsList);
    
    // Close participants list when clicking outside
    document.addEventListener('click', (e) => {
        const participantsSection = document.querySelector('.meeting-participants');
        if (!participantsSection.contains(e.target)) {
            closeParticipantsList();
        }
    });
    
    // Inline participant input handling
    const inlineInput = document.getElementById('participantInlineInput');
    inlineInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedSuggestionIndex >= 0 && currentSuggestions[selectedSuggestionIndex]) {
                selectSuggestion(currentSuggestions[selectedSuggestionIndex].email);
            } else {
                addParticipantFromInline();
            }
        }
        if (e.key === 'Escape') {
            hideInlineParticipantInput();
        }
    });
    
    inlineInput.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            if (currentSuggestions.length > 0 && selectedSuggestionIndex >= 0) {
                selectSuggestion(currentSuggestions[selectedSuggestionIndex].email);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            navigateSuggestions(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            navigateSuggestions(-1);
        }
    });
    
    inlineInput.addEventListener('input', (e) => {
        const value = e.target.value.trim();
        if (value.length >= 1) {
            clearTimeout(suggestionTimeout);
            suggestionTimeout = setTimeout(() => {
                fetchParticipantSuggestions(value);
            }, 300);
        } else {
            hideSuggestions();
        }
    });
    
    inlineInput.addEventListener('blur', (e) => {
        // Delay hiding to allow click on suggestions
        setTimeout(() => {
            // Only hide if user clicked outside the suggestions area
            const activeElement = document.activeElement;
            const suggestionsContainer = document.getElementById('participantSuggestions');
            
            if (!inlineInput.value.trim() && !suggestionsContainer.contains(activeElement)) {
                hideInlineParticipantInput();
            }
            hideSuggestions();
        }, 200);
    });
}

// Load meeting data from database
async function loadMeetingData() {
    try {
        console.log('📊 NOTES: Loading meeting data for ID:', currentMeetingId);
        console.log('📍 NOTES: Page URL:', window.location.href);
        console.log('🕒 NOTES: Load time:', new Date().toISOString());

        const meeting = await ipcRenderer.invoke('get-meeting-by-id', currentMeetingId);
        console.log('📊 NOTES: Meeting data received:', {
            id: meeting?.id,
            title: meeting?.title,
            startTime: meeting?.start_time,
            folderName: meeting?.folder_name
        });
        
        if (!meeting) {
            console.error('❌ Meeting not found for ID:', currentMeetingId);
            window.location.href = 'index.html';
            return;
        }
        
        // Update meeting details
        document.getElementById('meetingTitle').textContent = meeting.title;
        document.getElementById('meetingTime').textContent = formatMeetingTime(meeting.start_time, meeting.end_time);
        
        // Load participants
        let participants = [];
        try {
            participants = meeting.participants ? JSON.parse(meeting.participants) : [];
        } catch (e) {
            console.warn('Failed to parse participants, using empty array', e);
            participants = [];
        }
        renderParticipants(participants);
        
        // Load notes content
        console.log('Loading notes for meeting:', meeting.id, 'Notes content:', meeting.notes_content);
        // Store initial notes content for change detection
        initialNotesContent = meeting.notes_content || null;
        console.log('🔢 Initial notes content stored:', initialNotesContent ? 'exists' : 'null');
        
        if (meeting.notes_content) {
            // Set loading to true temporarily while setting content
            const wasLoading = isLoading;
            isLoading = true;
            try {
                const parsedContent = JSON.parse(meeting.notes_content);
                console.log('Parsed notes content:', parsedContent);
                // Validate it's a proper Quill Delta
                if (parsedContent && parsedContent.ops && Array.isArray(parsedContent.ops)) {
                    quill.setContents(parsedContent);
                } else {
                    // If it's not a proper Delta, treat as plain text
                    quill.setText(meeting.notes_content);
                }
            } catch (e) {
                console.warn('Failed to parse notes content as JSON, treating as plain text');
                // Try to parse as plain text if it's not JSON
                quill.setText(meeting.notes_content);
            }
            // Restore the loading state
            isLoading = wasLoading;
        } else {
            console.log('No notes content found for meeting', meeting.id);
        }
        
        // Check for existing recordings
        try {
            const recordings = await ipcRenderer.invoke('get-recording-sessions', currentMeetingId);
            console.log('🎙️ NOTES: Existing recordings:', recordings?.length || 0);
            recordings?.forEach((rec, index) => {
                console.log(`📼 NOTES: Recording ${index + 1}: ${rec.final_path} (${rec.duration}s)`);
            });
        } catch (error) {
            console.warn('⚠️ NOTES: Could not load recording sessions:', error);
        }

        // Load attachments
        await loadAttachments();

        // Set initial save status
        setSaveStatus('saved');
        
        // IMPORTANT: Set isLoading to false after all data is loaded
        isLoading = false;
        console.log('isLoading set to false - auto-save now enabled');
        
        // Hide the loading overlay
        hideLoadingOverlay();
        
    } catch (error) {
        console.error('Error loading meeting data:', error);
        setSaveStatus('error');
        isLoading = false; // Also set to false on error
        hideLoadingOverlay(); // Hide loading overlay on error too
    }
}

// Format meeting time for display
function formatMeetingTime(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    const startStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endStr = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `${startStr} - ${endStr}`;
}

// Global state for participants dropdown
let participantsListVisible = false;
let isAddingParticipants = false;
let isProcessingParticipantAdd = false;

// Render participants list
function renderParticipants(participants) {
    const participantsList = document.getElementById('participantsList');
    const participantsPill = document.getElementById('participantsPill');
    const participantsCollapsed = document.getElementById('participantsCollapsed');
    
    // Update the pill text
    participantsPill.textContent = `${participants.length} participant${participants.length !== 1 ? 's' : ''}`;
    
    // Clear and rebuild the list
    participantsList.innerHTML = '';
    
    participants.forEach(participant => {
        const participantEmail = document.createElement('div');
        participantEmail.className = 'participant-email';
        participantEmail.innerHTML = `
            <span>${participant}</span>
            <button class="participant-remove" onclick="removeParticipant('${participant}')">×</button>
        `;
        participantsList.appendChild(participantEmail);
    });
    
    // Show list if we're adding participants or if it was manually opened
    if (isAddingParticipants || participantsListVisible) {
        participantsList.style.display = 'flex';
    }
}

// Add participant from inline input
async function addParticipantFromInline() {
    const input = document.getElementById('participantInlineInput');
    const email = input.value.trim();
    
    if (!email || !isValidEmail(email)) {
        return;
    }
    
    try {
        const meeting = await ipcRenderer.invoke('get-meeting-by-id', currentMeetingId);
        let participants = [];
        try {
            participants = meeting.participants ? JSON.parse(meeting.participants) : [];
        } catch (e) {
            console.warn('Failed to parse participants in addParticipant');
            participants = [];
        }
        
        if (participants.includes(email)) {
            hideInlineParticipantInput();
            return;
        }
        
        participants.push(email);
        
        setSaveStatus('saving');
        await ipcRenderer.invoke('update-meeting-participants', currentMeetingId, participants);
        renderParticipants(participants);
        setSaveStatus('saved');
        
        hideInlineParticipantInput();
        
    } catch (error) {
        console.error('Error adding participant:', error);
    }
}

// Add participant from inline input but keep input active for multiple additions
async function addParticipantFromInlineContinuous() {
    if (isProcessingParticipantAdd) {
        return; // Prevent rapid additions
    }
    
    const input = document.getElementById('participantInlineInput');
    const email = input.value.trim();
    
    if (!email || !isValidEmail(email)) {
        return;
    }
    
    isProcessingParticipantAdd = true;
    
    try {
        const meeting = await ipcRenderer.invoke('get-meeting-by-id', currentMeetingId);
        let participants = [];
        try {
            participants = meeting.participants ? JSON.parse(meeting.participants) : [];
        } catch (e) {
            console.warn('Failed to parse participants in addParticipant');
            participants = [];
        }
        
        if (participants.includes(email)) {
            input.value = ''; // Clear input but keep it active
            input.focus();
            isProcessingParticipantAdd = false;
            return;
        }
        
        participants.push(email);
        
        setSaveStatus('saving');
        await ipcRenderer.invoke('update-meeting-participants', currentMeetingId, participants);
        renderParticipants(participants);
        setSaveStatus('saved');
        
        // Clear input and refocus for next addition
        input.value = '';
        input.placeholder = 'Participant added! Enter another email...';
        setTimeout(() => {
            input.placeholder = 'Enter email';
        }, 2000);
        input.focus();
        
    } catch (error) {
        console.error('Error adding participant:', error);
    } finally {
        isProcessingParticipantAdd = false;
    }
}

// Remove participant
async function removeParticipant(email) {
    try {
        const meeting = await ipcRenderer.invoke('get-meeting-by-id', currentMeetingId);
        let participants = [];
        try {
            participants = meeting.participants ? JSON.parse(meeting.participants) : [];
        } catch (e) {
            console.warn('Failed to parse participants in removeParticipant');
            participants = [];
        }
        
        const updatedParticipants = participants.filter(p => p !== email);
        
        setSaveStatus('saving');
        await ipcRenderer.invoke('update-meeting-participants', currentMeetingId, updatedParticipants);
        renderParticipants(updatedParticipants);
        setSaveStatus('saved');
        
    } catch (error) {
        console.error('Error removing participant:', error);
    }
}

// Toggle participants list visibility
function toggleParticipantsList() {
    participantsListVisible = !participantsListVisible;
    const participantsList = document.getElementById('participantsList');
    participantsList.style.display = participantsListVisible ? 'flex' : 'none';
}

// Close participants list
function closeParticipantsList() {
    if (participantsListVisible && !isAddingParticipants) {
        participantsListVisible = false;
        const participantsList = document.getElementById('participantsList');
        participantsList.style.display = 'none';
    }
}

// Validate email format
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Schedule auto-save
function scheduleAutoSave() {
    clearTimeout(saveTimeout);
    
    saveTimeout = setTimeout(() => {
        saveNotes();
    }, 1000); // Reduced from 3000ms to 1000ms
}

// Ensure notes are saved before navigation
async function ensureNotesAreSaved() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        await saveNotes();
    }
}

// Save notes to database
async function saveNotes() {
    try {
        const content = quill.getContents();
        const contentStr = JSON.stringify(content);
        console.log('Saving notes for meeting', currentMeetingId, content);
        await ipcRenderer.invoke('update-meeting-notes', currentMeetingId, contentStr);
        console.log('Notes saved successfully');
        setSaveStatus('saved');
        
        // Update initial content after successful save so we track changes from this point
        initialNotesContent = contentStr;
    } catch (error) {
        console.error('Error saving notes:', error);
        setSaveStatus('error');
    }
}

// Set save status indicator
function setSaveStatus(status) {
    console.log('Setting save status to:', status);
    const indicator = document.getElementById('saveIndicator');
    if (!indicator) {
        console.error('Save indicator element not found!');
        return;
    }
    indicator.className = `status-indicator ${status}`;

    // Update tooltip with enhanced descriptions
    const tooltips = {
        saved: 'Notes are saved',
        saving: 'Saving notes...',
        error: 'Error saving notes'
    };
    indicator.title = tooltips[status] || 'Save Status';
    console.log('Save status indicator updated to:', status);
}

// Set recording status indicator
function setRecordingStatus(recordingStatus) {
    const indicator = document.getElementById('recordingIndicator');

    if (!recordingStatus || !recordingStatus.isRecording) {
        indicator.className = 'status-indicator';
        indicator.title = 'Click to start recording';
        return;
    }

    if (recordingStatus.isPaused) {
        indicator.className = 'status-indicator paused';
        indicator.title = `Recording paused (${formatDuration(recordingStatus.duration)}) - Click to resume`;
    } else {
        indicator.className = 'status-indicator recording';
        indicator.title = `Recording active (${formatDuration(recordingStatus.duration)}) - Click to pause`;
    }
}

// Initialize recording functionality
async function initializeRecording() {
    try {
        console.log('🎙️ NOTES: Initializing recording for meeting:', currentMeetingId);

        // Set up recording indicator click handler
        const recordingIndicator = document.getElementById('recordingIndicator');
        recordingIndicator.addEventListener('click', handleRecordingIndicatorClick);

        // Start recording automatically when entering meeting page
        await startRecording();

        // Set up periodic status updates
        startRecordingStatusUpdates();

        // Initialize file growth monitoring
        console.log('🔍 NOTES: Starting file growth monitoring...');
        await initializeFileGrowthMonitoring();

    } catch (error) {
        console.error('❌ NOTES: Error initializing recording:', error);
        setRecordingStatus(null);
    }
}

// Start recording for current meeting
async function startRecording() {
    try {
        console.log('Starting recording for meeting:', currentMeetingId);
        
        // Validate meeting ID before starting recording
        const meetingId = parseInt(currentMeetingId);
        if (isNaN(meetingId)) {
            console.error('Cannot start recording for invalid meeting ID:', currentMeetingId);
            setRecordingStatus(null);
            return;
        }
        
        const result = await ipcRenderer.invoke('start-recording', meetingId);
        currentRecordingStatus = result;
        setRecordingStatus(currentRecordingStatus);
        console.log('Recording started:', result);
    } catch (error) {
        console.error('Error starting recording:', error);
        setRecordingStatus(null);
    }
}

// Stop recording for current meeting
async function stopRecording() {
    try {
        console.log('Stopping recording for meeting:', currentMeetingId);
        
        // Validate meeting ID before stopping recording
        const meetingId = parseInt(currentMeetingId);
        if (isNaN(meetingId)) {
            console.error('Cannot stop recording for invalid meeting ID:', currentMeetingId);
            setRecordingStatus(null);
            return;
        }
        
        const result = await ipcRenderer.invoke('stop-recording', meetingId);
        currentRecordingStatus = result;
        setRecordingStatus(currentRecordingStatus);
        console.log('Recording stopped:', result);
    } catch (error) {
        console.error('Error stopping recording:', error);
    }
}

// Handle recording indicator click (pause/resume)
async function handleRecordingIndicatorClick() {
    try {
        if (!currentRecordingStatus || !currentRecordingStatus.isRecording) {
            // Not recording, start recording
            await startRecording();
            return;
        }
        
        if (currentRecordingStatus.isPaused) {
            // Currently paused, resume recording
            console.log('Resuming recording for meeting:', currentMeetingId);
            
            // Validate meeting ID before resuming recording
            const meetingId = parseInt(currentMeetingId);
            if (isNaN(meetingId)) {
                console.error('Cannot resume recording for invalid meeting ID:', currentMeetingId);
                setRecordingStatus(null);
                return;
            }
            
            const result = await ipcRenderer.invoke('resume-recording', meetingId);
            currentRecordingStatus = result;
            setRecordingStatus(currentRecordingStatus);
            console.log('Recording resumed:', result);
        } else {
            // Currently recording, pause recording
            console.log('Pausing recording for meeting:', currentMeetingId);
            
            // Validate meeting ID before pausing recording
            const meetingId = parseInt(currentMeetingId);
            if (isNaN(meetingId)) {
                console.error('Cannot pause recording for invalid meeting ID:', currentMeetingId);
                setRecordingStatus(null);
                return;
            }
            
            const result = await ipcRenderer.invoke('pause-recording', meetingId);
            currentRecordingStatus = result;
            setRecordingStatus(currentRecordingStatus);
            console.log('Recording paused:', result);
        }
    } catch (error) {
        console.error('Error handling recording indicator click:', error);
    }
}

// Start periodic recording status updates
function startRecordingStatusUpdates() {
    // Update recording status every 2 seconds
    recordingStatusInterval = setInterval(async () => {
        try {
            // Validate meeting ID before getting recording status
            const meetingId = parseInt(currentMeetingId);
            if (isNaN(meetingId)) {
                // Skip status update for invalid meeting IDs
                return;
            }
            
            const status = await ipcRenderer.invoke('get-recording-status', meetingId);
            currentRecordingStatus = status;
            setRecordingStatus(currentRecordingStatus);
        } catch (error) {
            console.error('Error updating recording status:', error);
        }
    }, 2000);
}

// Stop recording status updates
function stopRecordingStatusUpdates() {
    if (recordingStatusInterval) {
        clearInterval(recordingStatusInterval);
        recordingStatusInterval = null;
    }
}

// Initialize file growth monitoring
async function initializeFileGrowthMonitoring() {
    console.log('🔍 GROWTH: Initializing file growth monitoring');

    // Set up periodic file growth checks every 30 seconds
    fileGrowthInterval = setInterval(async () => {
        await checkFileGrowth();
    }, 30000);

    // Initial check
    await checkFileGrowth();
}

// Check if recording file is growing
async function checkFileGrowth() {
    try {
        console.log('📊 GROWTH: Checking file growth...');

        const meetingId = parseInt(currentMeetingId);
        if (isNaN(meetingId)) {
            console.log('⚠️ GROWTH: Invalid meeting ID, skipping check');
            return;
        }

        const result = await ipcRenderer.invoke('get-file-growth-status', meetingId);
        console.log('📋 GROWTH: File status result:', result);

        if (!result.exists) {
            if (result.isActive === false) {
                setFileGrowthStatus('no-file', 'No recording file found');
            } else {
                setFileGrowthStatus('no-file', 'No recording file found');
            }
            console.log('📁 GROWTH: No file found or not active');
            return;
        }

        const currentSize = result.size;
        const currentTime = result.timestamp;

        // Add to history
        fileGrowthHistory.push({ size: currentSize, time: currentTime });

        // Keep only last 3 checks (90 seconds of history)
        if (fileGrowthHistory.length > 3) {
            fileGrowthHistory.shift();
        }

        // Determine if file is growing
        let isGrowing = false;
        let growthMessage = '';

        if (fileGrowthHistory.length >= 2) {
            const oldest = fileGrowthHistory[0];
            const newest = fileGrowthHistory[fileGrowthHistory.length - 1];
            const sizeDiff = newest.size - oldest.size;
            const timeDiff = (newest.time - oldest.time) / 1000; // seconds

            console.log(`📈 GROWTH: Size difference: ${sizeDiff} bytes over ${timeDiff} seconds`);

            if (sizeDiff > 1000) { // At least 1KB growth
                isGrowing = true;
                const growthRate = Math.round(sizeDiff / timeDiff);
                growthMessage = `Audio file growing: ${growthRate.toLocaleString()} bytes/sec - Recording working properly`;
            } else {
                isGrowing = false;
                growthMessage = `Audio file not growing (${sizeDiff} bytes in ${Math.round(timeDiff)}s) - Check microphone or restart recording`;
            }
        } else {
            // First few checks, assume growing if file exists
            const fileSizeKB = Math.round(currentSize / 1024);
            growthMessage = `Monitoring file: ${fileSizeKB.toLocaleString()}KB - Checking growth...`;
            isGrowing = true;
        }

        setFileGrowthStatus(isGrowing ? 'growing' : 'not-growing', growthMessage);

        console.log(`🎯 GROWTH: File ${isGrowing ? 'IS' : 'NOT'} growing - ${growthMessage}`);

    } catch (error) {
        console.error('❌ GROWTH: Error checking file growth:', error);
        setFileGrowthStatus('no-file', 'Error checking file');
    }
}

// Set file growth status indicator
function setFileGrowthStatus(status, message) {
    const indicator = document.getElementById('fileGrowthIndicator');
    if (!indicator) {
        console.error('❌ GROWTH: File growth indicator element not found!');
        return;
    }

    indicator.className = `status-indicator ${status}`;

    // Set enhanced tooltip based on status
    const defaultTooltips = {
        'growing': 'Audio file is growing - Recording working properly',
        'not-growing': 'Audio file not growing - Check microphone or restart recording',
        'no-file': 'No recording file found',
        '': 'File growth monitoring disabled'
    };

    // Use custom message if provided, otherwise use default
    indicator.title = message || defaultTooltips[status] || 'File Growth Status';

    console.log(`🔄 GROWTH: Status updated to: ${status} (${indicator.title})`);
}

// Stop file growth monitoring
function stopFileGrowthMonitoring() {
    if (fileGrowthInterval) {
        clearInterval(fileGrowthInterval);
        fileGrowthInterval = null;
        console.log('🛑 GROWTH: File growth monitoring stopped');
    }
}

// Format duration in seconds to MM:SS format
function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '00:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Load attachments for this meeting
async function loadAttachments() {
    try {
        const attachments = await ipcRenderer.invoke('get-meeting-attachments', currentMeetingId);
        
        console.log('Meeting attachments:', attachments);
        
        // Clear existing tiles
        const attachmentsGrid = document.getElementById('attachmentsGrid');
        attachmentsGrid.innerHTML = '';
        
        // Create tiles for existing attachments
        for (const attachment of attachments) {
            // Get file size from disk if available
            const fileSize = await getAttachmentFileSize(attachment.filename);
            createAttachmentTile(attachment.original_name, attachment.filename, fileSize);
        }
        
    } catch (error) {
        console.error('Error loading attachments:', error);
    }
}

// Get file size for existing attachment
async function getAttachmentFileSize(filename) {
    try {
        const result = await ipcRenderer.invoke('get-attachment-info', currentMeetingId, filename);
        return result.size || 0;
    } catch (error) {
        console.error('Error getting attachment size:', error);
        return 0;
    }
}

// Setup drag and drop for attachments (entire page)
function setupDragAndDrop() {
    const container = document.querySelector('.container');
    
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        container.classList.add('drag-over');
    });
    
    container.addEventListener('dragleave', (e) => {
        e.preventDefault();
        // Only remove drag-over if we're leaving the container entirely
        if (!container.contains(e.relatedTarget)) {
            container.classList.remove('drag-over');
        }
    });
    
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        container.classList.remove('drag-over');
        
        const files = Array.from(e.dataTransfer.files);
        handleFileUpload(files);
    });
}

// Handle file upload
async function handleFileUpload(files) {
    console.log('Files dropped:', files);
    
    if (!files || files.length === 0) return;
    
    setSaveStatus('saving');
    
    try {
        for (const file of files) {
            console.log('Uploading file:', file.name, 'Size:', file.size);
            
            // Create attachment record in database
            const result = await ipcRenderer.invoke('upload-attachment', currentMeetingId, {
                name: file.name,
                path: file.path,
                size: file.size,
                type: file.type
            });
            
            if (result.success) {
                console.log('File uploaded successfully:', result.filename);
                
                // Create attachment tile
                createAttachmentTile(file.name, result.filename, file.size);
            } else {
                console.error('Failed to upload file:', file.name);
            }
        }
        
        setSaveStatus('saved');
        
    } catch (error) {
        console.error('Error uploading files:', error);
        setSaveStatus('error');
        alert('Error uploading files: ' + error.message);
    }
}

// Create attachment tile
function createAttachmentTile(originalName, filename, size) {
    const formatSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
        return Math.round(bytes / (1024 * 1024)) + ' MB';
    };
    
    const attachmentsGrid = document.getElementById('attachmentsGrid');
    
    const tile = document.createElement('div');
    tile.className = 'attachment-tile';
    tile.dataset.filename = filename;
    
    tile.innerHTML = `
        <div class="attachment-tile-name">${originalName}</div>
        <div class="attachment-tile-size">${formatSize(size)}</div>
        <button class="attachment-remove" onclick="removeAttachmentTile('${filename}')">×</button>
    `;
    
    // Click to open file
    tile.addEventListener('click', (e) => {
        if (e.target.classList.contains('attachment-remove')) {
            return; // Don't open if clicking remove button
        }
        openAttachment(filename, originalName);
    });
    
    attachmentsGrid.appendChild(tile);
}

// Hide loading overlay
function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.add('hidden');
}

// Show loading overlay
function showLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.remove('hidden');
}

// Title editing functions
function startEditingTitle() {
    const titleElement = document.getElementById('meetingTitle');
    const inputElement = document.getElementById('meetingTitleInput');
    
    inputElement.value = titleElement.textContent;
    titleElement.style.display = 'none';
    inputElement.style.display = 'block';
    inputElement.focus();
    inputElement.select();
}

async function saveTitle() {
    const titleElement = document.getElementById('meetingTitle');
    const inputElement = document.getElementById('meetingTitleInput');
    
    const newTitle = inputElement.value.trim();
    if (newTitle && newTitle !== titleElement.textContent) {
        try {
            setSaveStatus('saving');
            const result = await ipcRenderer.invoke('update-meeting-title', currentMeetingId, newTitle);
            titleElement.textContent = newTitle;
            
            if (result.folderRenamed) {
                setSaveStatus('saved');
                console.log('Title and folder updated successfully. New folder:', result.newFolderName);
            } else if (result.error) {
                setSaveStatus('saved');
                console.warn('Title updated but folder rename failed:', result.error);
                // Could show a subtle warning to user if desired
            } else {
                setSaveStatus('saved');
            }
        } catch (error) {
            console.error('Error updating meeting title:', error);
            setSaveStatus('error');
        }
    }
    
    // Hide input, show title
    inputElement.style.display = 'none';
    titleElement.style.display = 'block';
}

function cancelEditTitle() {
    const titleElement = document.getElementById('meetingTitle');
    const inputElement = document.getElementById('meetingTitleInput');
    
    // Hide input, show title without saving
    inputElement.style.display = 'none';
    titleElement.style.display = 'block';
}

// Inline participant input functions
function showInlineParticipantInput() {
    const inputPill = document.getElementById('participantInputPill');
    const input = document.getElementById('participantInlineInput');
    const participantsList = document.getElementById('participantsList');
    
    isAddingParticipants = true;
    inputPill.style.display = 'inline-flex';
    participantsList.style.display = 'flex'; // Show expanded list when adding
    input.value = '';
    input.focus();
    selectedSuggestionIndex = -1;
    currentSuggestions = [];
}

function hideInlineParticipantInput() {
    const inputPill = document.getElementById('participantInputPill');
    const input = document.getElementById('participantInlineInput');
    const participantsList = document.getElementById('participantsList');
    
    isAddingParticipants = false;
    inputPill.style.display = 'none';
    input.value = '';
    hideSuggestions();
    
    // Hide participants list if not manually opened
    if (!participantsListVisible) {
        participantsList.style.display = 'none';
    }
}

// Participant suggestion functions
async function fetchParticipantSuggestions(searchTerm) {
    try {
        const suggestions = await ipcRenderer.invoke('get-participant-suggestions', searchTerm);
        currentSuggestions = suggestions;
        selectedSuggestionIndex = suggestions.length > 0 ? 0 : -1; // Auto-select first item
        displaySuggestions(suggestions, searchTerm);
    } catch (error) {
        console.error('Error fetching suggestions:', error);
        hideSuggestions();
    }
}

function displaySuggestions(suggestions, searchTerm) {
    const container = document.getElementById('participantSuggestions');
    
    if (suggestions.length === 0) {
        hideSuggestions();
        return;
    }
    
    container.innerHTML = '';
    
    suggestions.forEach((suggestion, index) => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        if (index === selectedSuggestionIndex) {
            item.classList.add('selected');
        }
        
        // Highlight matching part
        const email = suggestion.email;
        const matchIndex = email.toLowerCase().indexOf(searchTerm.toLowerCase());
        
        if (matchIndex >= 0) {
            const before = email.substring(0, matchIndex);
            const match = email.substring(matchIndex, matchIndex + searchTerm.length);
            const after = email.substring(matchIndex + searchTerm.length);
            
            item.innerHTML = `
                ${before}<strong>${match}</strong>${after}
                <span class="suggestion-frequency">${suggestion.frequency} meetings</span>
            `;
        } else {
            item.innerHTML = `
                ${email}
                <span class="suggestion-frequency">${suggestion.frequency} meetings</span>
            `;
        }
        
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectSuggestion(suggestion.email);
        });
        
        item.addEventListener('mouseenter', () => {
            selectedSuggestionIndex = index;
            updateSuggestionSelection();
        });
        
        container.appendChild(item);
    });
    
    container.style.display = 'block';
}

function hideSuggestions() {
    const container = document.getElementById('participantSuggestions');
    container.style.display = 'none';
    container.innerHTML = '';
    currentSuggestions = [];
    selectedSuggestionIndex = -1;
}

function navigateSuggestions(direction) {
    if (currentSuggestions.length === 0) return;
    
    selectedSuggestionIndex += direction;
    
    if (selectedSuggestionIndex < 0) {
        selectedSuggestionIndex = currentSuggestions.length - 1;
    } else if (selectedSuggestionIndex >= currentSuggestions.length) {
        selectedSuggestionIndex = 0;
    }
    
    updateSuggestionSelection();
}

function updateSuggestionSelection() {
    const items = document.querySelectorAll('.suggestion-item');
    items.forEach((item, index) => {
        if (index === selectedSuggestionIndex) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

function selectSuggestion(email) {
    if (isProcessingParticipantAdd) {
        return; // Prevent rapid selections
    }
    
    const input = document.getElementById('participantInlineInput');
    input.value = email;
    addParticipantFromInlineContinuous();
    hideSuggestions();
}

// Attachment management functions
async function openAttachment(filename, originalName) {
    try {
        const result = await ipcRenderer.invoke('open-attachment', currentMeetingId, filename);
        if (result.success) {
            console.log('File opened:', originalName);
        } else {
            alert('Failed to open file');
        }
    } catch (error) {
        console.error('Error opening attachment:', error);
        alert('Error opening file: ' + error.message);
    }
}

async function removeAttachmentTile(filename) {
    try {
        setSaveStatus('saving');
        const result = await ipcRenderer.invoke('remove-attachment', currentMeetingId, filename);
        if (result.success) {
            // Remove tile from UI
            const tile = document.querySelector(`[data-filename="${filename}"]`);
            if (tile) {
                tile.remove();
            }
        } else {
            alert('Failed to remove attachment');
        }
        setSaveStatus('saved');
    } catch (error) {
        console.error('Error removing attachment:', error);
        setSaveStatus('error');
        alert('Error removing attachment: ' + error.message);
    }
}

// Update meeting duration to actual time spent
async function updateMeetingDurationToActual() {
    try {
        // Get meeting data to find start time
        const meeting = await ipcRenderer.invoke('get-meeting-by-id', currentMeetingId);
        if (!meeting) {
            console.warn('⚠️ Meeting not found, cannot update duration');
            return;
        }
        
        const startTime = new Date(meeting.start_time);
        const actualEndTime = new Date();
        
        // Calculate actual duration in minutes
        const durationMinutes = Math.round((actualEndTime - startTime) / (1000 * 60));
        
        // Apply minimum duration threshold (5 minutes)
        const minimumDuration = 5;
        if (durationMinutes < minimumDuration) {
            console.log(`⏱️ Actual duration (${durationMinutes}min) below minimum (${minimumDuration}min), keeping original duration`);
            return;
        }
        
        // Validate that end time is after start time (handle clock changes)
        if (actualEndTime <= startTime) {
            console.warn('⚠️ Invalid duration detected (end time not after start time), keeping original duration');
            return;
        }
        
        console.log(`⏱️ Updating meeting duration: ${durationMinutes} minutes (from ${startTime.toLocaleTimeString()} to ${actualEndTime.toLocaleTimeString()})`);
        
        // Update the meeting end time in database
        await ipcRenderer.invoke('update-meeting-end-time', currentMeetingId, actualEndTime.toISOString());
        
        console.log('✅ Meeting duration updated successfully');
    } catch (error) {
        console.error('Error updating meeting duration:', error);
        throw error; // Re-throw to be caught by caller
    }
}

// Handle navigation back to nav page
async function handleNavigationBack() {
    console.log('🔙 handleNavigationBack called');
    
    // Also log to main process so we can see it in terminal
    ipcRenderer.invoke('log-to-main', '🔙 MARKDOWN EXPORT: handleNavigationBack called');
    
    try {
        // Ensure notes are saved first
        console.log('💾 Ensuring notes are saved...');
        await ensureNotesAreSaved();
        
        // Update meeting duration to actual time spent
        try {
            console.log('⏱️ Updating meeting duration to actual time...');
            await updateMeetingDurationToActual();
        } catch (durationError) {
            console.warn('⚠️ Failed to update meeting duration (non-critical):', durationError);
            // Don't prevent navigation - this is a nice-to-have feature
        }
        
        // Stop recording if active and wait for database update
        if (currentRecordingStatus && currentRecordingStatus.isRecording) {
            console.log('🛑 Stopping recording before navigation...');
            
            // Validate meeting ID before stopping recording
            const meetingId = parseInt(currentMeetingId);
            if (isNaN(meetingId)) {
                console.log('Skipping recording stop for non-numeric meeting ID:', currentMeetingId);
            } else {
                const stopResult = await ipcRenderer.invoke('stop-recording', meetingId);
                if (stopResult.success) {
                    console.log('✅ Recording stopped successfully');
                }
            }
        }
        
        // Get current notes content
        const currentContent = quill.getContents();
        const currentContentStr = JSON.stringify(currentContent);
        
        console.log('📝 Initial notes content:', initialNotesContent ? 'exists' : 'null');
        console.log('📝 Current notes content length:', currentContentStr.length);
        
        ipcRenderer.invoke('log-to-main', `📝 MARKDOWN EXPORT: Initial=${initialNotesContent ? 'exists' : 'null'}, Current length=${currentContentStr.length}`);
        
        // Always export markdown (replace existing file)
        console.log('📄 Always exporting markdown file...');
        ipcRenderer.invoke('log-to-main', '📄 MARKDOWN EXPORT: Always exporting markdown file...');
        
        // Delete existing markdown if any
        console.log('🗑️ Deleting existing markdown if any...');
        await ipcRenderer.invoke('delete-meeting-markdown', currentMeetingId);
        
        // Export new markdown file
        console.log('📄 Exporting new markdown file...');
        const exportResult = await ipcRenderer.invoke('export-meeting-notes-markdown', currentMeetingId);
        if (exportResult.success) {
            console.log('✅ Meeting notes exported to markdown:', exportResult.filename);
            console.log('📂 File path:', exportResult.filePath);
            ipcRenderer.invoke('log-to-main', `✅ MARKDOWN EXPORT: Success! File: ${exportResult.filename}`);
            
            // Queue upload to Google Drive (markdown + audio files)
            console.log('📤 Queueing meeting upload to Google Drive...');
            ipcRenderer.invoke('log-to-main', `📤 UPLOAD: Queueing upload for meeting ${currentMeetingId}`);
            try {
                const uploadResult = await ipcRenderer.invoke('queue-meeting-upload', currentMeetingId);
                if (uploadResult.success) {
                    console.log('✅ Meeting upload queued successfully');
                    ipcRenderer.invoke('log-to-main', `✅ UPLOAD: Meeting ${currentMeetingId} queued for upload`);
                } else {
                    console.error('❌ Failed to queue meeting upload:', uploadResult.error);
                    ipcRenderer.invoke('log-to-main', `❌ UPLOAD: Failed to queue - ${uploadResult.error}`);
                }
            } catch (uploadError) {
                console.error('❌ Error queueing upload:', uploadError);
                ipcRenderer.invoke('log-to-main', `❌ UPLOAD: Error - ${uploadError.message}`);
            }
            
        } else {
            console.error('❌ Failed to export meeting notes:', exportResult.error);
            ipcRenderer.invoke('log-to-main', `❌ MARKDOWN EXPORT: Failed - ${exportResult.error}`);
        }
        
        // Clean up export manager before navigation (temporarily disabled)
        // if (window.markdownExportManager) {
        //     window.markdownExportManager.cleanup();
        // }
        
        // Small delay for logs (can be removed later)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Navigate back to index
        console.log('🏠 Navigating back to index.html');
        window.location.href = 'index.html';
        
    } catch (error) {
        console.error('❌ Error handling navigation back:', error);
        ipcRenderer.invoke('log-to-main', `❌ MARKDOWN EXPORT: Error - ${error.message}`);
        // Still navigate even if export fails
        window.location.href = 'index.html';
    }
}

// Make functions available globally
window.removeParticipant = removeParticipant;
window.openAttachment = openAttachment;
window.removeAttachmentTile = removeAttachmentTile;