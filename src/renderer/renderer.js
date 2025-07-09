const { ipcRenderer } = require('electron');

class MeetingApp {
    constructor() {
        this.meetings = [];
        this.selectedMeeting = null;
        this.isLoading = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateTodayDate();
        this.loadMeetings();
        
        setInterval(() => this.updateMeetingStatuses(), 30000);
    }

    setupEventListeners() {
        const refreshBtn = document.getElementById('refresh-btn');
        refreshBtn.addEventListener('click', () => this.refreshMeetings());

        ipcRenderer.on('meetings-refreshed', () => {
            this.loadMeetings();
        });
    }

    updateTodayDate() {
        const today = new Date();
        const dateStr = today.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        document.getElementById('today-date').textContent = dateStr;
    }

    async loadMeetings() {
        this.setLoading(true);
        try {
            this.meetings = await ipcRenderer.invoke('get-todays-meetings');
            this.renderMeetings();
            this.updateStatus(`Loaded ${this.meetings.length} meetings for today`);
        } catch (error) {
            console.error('Error loading meetings:', error);
            this.showError('Failed to load meetings: ' + error.message);
        } finally {
            this.setLoading(false);
        }
    }

    async refreshMeetings() {
        const refreshBtn = document.getElementById('refresh-btn');
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
        
        try {
            await ipcRenderer.invoke('refresh-meetings');
            this.showSuccess('Meetings refreshed successfully');
        } catch (error) {
            console.error('Error refreshing meetings:', error);
            this.showError('Failed to refresh meetings: ' + error.message);
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh';
        }
    }

    renderMeetings() {
        const container = document.getElementById('meetings-container');
        
        if (this.meetings.length === 0) {
            container.innerHTML = this.renderNoMeetings();
            return;
        }

        const meetingList = document.createElement('div');
        meetingList.className = 'meeting-list';
        
        this.meetings.forEach(meeting => {
            const meetingElement = this.createMeetingElement(meeting);
            meetingList.appendChild(meetingElement);
        });

        container.innerHTML = '';
        container.appendChild(meetingList);
    }

    renderNoMeetings() {
        return `
            <div class="no-meetings">
                <h2>No meetings scheduled for today</h2>
                <p>Select an Excel file to import your meeting schedule</p>
                <button class="select-excel-btn" onclick="this.selectExcelFile()">Select Excel File</button>
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

        meetingDiv.innerHTML = `
            <div class="meeting-header">
                <div>
                    <div class="meeting-title">${this.escapeHtml(meeting.title)}</div>
                    <div class="meeting-time">
                        <span>⏰ ${this.formatTime(startTime)} - ${this.formatTime(endTime)}</span>
                    </div>
                </div>
                <div class="meeting-status status-${status.class}">${status.text}</div>
            </div>
            
            ${participants.length > 0 ? `
                <div class="meeting-participants">
                    👥 ${participants.slice(0, 3).join(', ')}${participants.length > 3 ? ` and ${participants.length - 3} more` : ''}
                </div>
            ` : ''}

            <div class="meeting-actions">
                <button class="action-btn primary" onclick="app.openMeetingNotes(${meeting.id})">
                    📝 Notes
                </button>
                <button class="action-btn success" onclick="app.startRecording(${meeting.id})" ${status.class !== 'active' ? 'disabled' : ''}>
                    🎙️ Record
                </button>
                <button class="action-btn" onclick="app.addAttachment(${meeting.id})">
                    📎 Attach
                </button>
            </div>
        `;

        meetingDiv.addEventListener('click', (e) => {
            if (!e.target.classList.contains('action-btn')) {
                this.selectMeeting(meeting);
            }
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

    async startRecording(meetingId) {
        console.log('Starting recording for meeting:', meetingId);
        this.showSuccess('Recording feature will be implemented in Milestone 3');
    }

    async addAttachment(meetingId) {
        console.log('Adding attachment for meeting:', meetingId);
        this.showSuccess('Attachment feature will be implemented in Milestone 2');
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
        document.getElementById('status-text').textContent = message;
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

    selectExcelFile() {
        console.log('Selecting Excel file...');
    }
}

const app = new MeetingApp();