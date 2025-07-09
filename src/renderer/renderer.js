const { ipcRenderer } = require('electron');

class MeetingApp {
    constructor() {
        this.meetings = [];
        this.allMeetings = [];
        this.selectedMeeting = null;
        this.isLoading = false;
        this.showingAll = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadMeetings();
        
        setInterval(() => this.updateMeetingStatuses(), 30000);
    }

    setupEventListeners() {
        const newNoteBtn = document.getElementById('new-note-btn');
        newNoteBtn.addEventListener('click', () => this.createNewNote());

        const showMoreBtn = document.getElementById('show-more-btn');
        showMoreBtn.addEventListener('click', () => this.toggleShowMore());

        ipcRenderer.on('meetings-refreshed', () => {
            this.loadMeetings();
        });
    }

    async loadMeetings() {
        this.setLoading(true);
        try {
            this.meetings = await ipcRenderer.invoke('get-todays-meetings');
            this.showingAll = false;
            
            // Reset show more button
            const showMoreBtn = document.getElementById('show-more-btn');
            showMoreBtn.textContent = 'Show more ▼';
            
            this.renderMeetings();
            this.updateStatus(`Loaded ${this.meetings.length} meetings for today`);
        } catch (error) {
            console.error('Error loading meetings:', error);
            this.showError('Failed to load meetings: ' + error.message);
        } finally {
            this.setLoading(false);
        }
    }

    async createNewNote() {
        console.log('Creating new note...');
        this.showSuccess('New note feature will be implemented in Milestone 2');
    }

    async toggleShowMore() {
        const showMoreBtn = document.getElementById('show-more-btn');
        
        try {
            if (this.showingAll) {
                // Switch back to filtered meetings
                this.showingAll = false;
                this.meetings = await ipcRenderer.invoke('get-todays-meetings');
                showMoreBtn.textContent = 'Show more ▼';
                console.log(`Showing filtered meetings: ${this.meetings.length}`);
            } else {
                // Show all meetings including filtered ones
                this.showingAll = true;
                this.allMeetings = await ipcRenderer.invoke('get-all-todays-meetings');
                this.meetings = this.allMeetings;
                showMoreBtn.textContent = 'Show less ▲';
                console.log(`Showing all meetings: ${this.meetings.length}`);
            }
            
            this.renderMeetings();
            this.updateStatus(`Showing ${this.meetings.length} meetings for today`);
        } catch (error) {
            console.error('Error in toggleShowMore:', error);
            this.showError('Failed to toggle meetings view: ' + error.message);
        }
    }

    renderMeetings() {
        const container = document.getElementById('meetings-container');
        
        if (this.meetings.length === 0) {
            container.innerHTML = this.renderNoMeetings();
            return;
        }

        const meetingsCard = document.createElement('div');
        meetingsCard.className = 'meetings-card';
        
        this.meetings.forEach(meeting => {
            const meetingElement = this.createMeetingElement(meeting);
            meetingsCard.appendChild(meetingElement);
        });

        container.innerHTML = '';
        container.appendChild(meetingsCard);
    }

    renderNoMeetings() {
        return `
            <div class="no-meetings">
                <h2>No meetings scheduled for today</h2>
                <p>Your calendar is clear for today!</p>
            </div>
        `;
    }

    createMeetingElement(meeting) {
        const meetingDiv = document.createElement('div');
        meetingDiv.className = 'meeting-item';
        meetingDiv.dataset.meetingId = meeting.id;

        const startTime = new Date(meeting.start_time);
        const endTime = new Date(meeting.end_time);
        const status = this.getMeetingStatus(startTime, endTime);
        const participants = meeting.participants ? JSON.parse(meeting.participants) : [];

        // Format date for badge
        const dateStr = startTime.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
        }).replace(' ', ' ').toUpperCase();

        // Count participants
        let participantText = '';
        if (participants.length === 1) {
            participantText = '1 participant';
        } else if (participants.length > 1) {
            participantText = `${participants.length} participants`;
        }

        meetingDiv.innerHTML = `
            <div class="meeting-header">
                <div class="date-badge">${dateStr}</div>
                <div class="meeting-info">
                    <div class="meeting-title">${this.escapeHtml(meeting.title)}</div>
                    <div class="meeting-time">
                        <span class="status-indicator status-${status.class}"></span>
                        ${this.formatTime(startTime)} - ${this.formatTime(endTime)}
                    </div>
                    ${participantText ? `<div class="meeting-participants">${participantText}</div>` : ''}
                </div>
            </div>
        `;

        meetingDiv.addEventListener('click', (e) => {
            this.selectMeeting(meeting);
        });

        return meetingDiv;
    }

    getMeetingStatus(startTime, endTime) {
        const now = new Date();
        
        if (now < startTime) {
            return { class: 'upcoming', text: 'Upcoming' };
        } else if (now >= startTime && now <= endTime) {
            return { class: 'active', text: 'Active' };
        } else {
            return { class: 'past', text: 'Past' };
        }
    }

    formatTime(date) {
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    selectMeeting(meeting) {
        document.querySelectorAll('.meeting-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const meetingElement = document.querySelector(`[data-meeting-id="${meeting.id}"]`);
        if (meetingElement) {
            meetingElement.classList.add('active');
        }
        
        this.selectedMeeting = meeting;
    }

    async openMeetingNotes(meetingId) {
        console.log('Opening notes for meeting:', meetingId);
        this.showSuccess('Notes feature will be implemented in Milestone 2');
    }

    updateMeetingStatuses() {
        document.querySelectorAll('.meeting-item').forEach(item => {
            const meetingId = parseInt(item.dataset.meetingId);
            const meeting = this.meetings.find(m => m.id === meetingId);
            if (meeting) {
                const startTime = new Date(meeting.start_time);
                const endTime = new Date(meeting.end_time);
                const status = this.getMeetingStatus(startTime, endTime);
                
                const statusElement = item.querySelector('.meeting-status');
                statusElement.className = `meeting-status status-${status.class}`;
                statusElement.textContent = status.text;
                
                const recordBtn = item.querySelector('.action-btn.success');
                recordBtn.disabled = status.class !== 'active';
            }
        });
    }

    setLoading(loading) {
        this.isLoading = loading;
        const loadingIndicator = document.getElementById('loading-indicator');
        const container = document.getElementById('meetings-container');
        
        if (loading) {
            container.innerHTML = '<div class="loading">Loading meetings...</div>';
        } else {
            const loadingDiv = container.querySelector('.loading');
            if (loadingDiv) {
                loadingDiv.remove();
            }
        }
    }

    updateStatus(message) {
        const statusElement = document.getElementById('status-text');
        if (statusElement) {
            statusElement.textContent = message;
        } else {
            console.log('Status:', message);
        }
    }

    showError(message) {
        this.removeMessages();
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        document.querySelector('.content').insertBefore(errorDiv, document.querySelector('.meetings-container'));
        
        setTimeout(() => errorDiv.remove(), 5000);
    }

    showSuccess(message) {
        this.removeMessages();
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        document.querySelector('.content').insertBefore(successDiv, document.querySelector('.meetings-container'));
        
        setTimeout(() => successDiv.remove(), 3000);
    }

    removeMessages() {
        document.querySelectorAll('.error-message, .success-message').forEach(msg => msg.remove());
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

}

const app = new MeetingApp();