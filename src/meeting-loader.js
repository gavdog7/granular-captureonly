const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs-extra');

class MeetingLoader {
  constructor(database, store) {
    this.database = database;
    this.store = store;
    this.lastParsedTime = null;
    this.cachedMeetings = [];
  }

  async loadTodaysMeetings() {
    const excelFilePath = this.store.get('excelFilePath');
    
    if (!excelFilePath) {
      throw new Error('No Excel file selected. Please select an Excel file first.');
    }

    if (!await fs.pathExists(excelFilePath)) {
      throw new Error(`Excel file not found: ${excelFilePath}`);
    }

    try {
      const workbook = XLSX.readFile(excelFilePath);
      const meetings = await this.parseExcelFile(workbook);
      const today = new Date().toISOString().split('T')[0];
      
      const todaysMeetings = meetings.filter(meeting => {
        const meetingDate = new Date(meeting.startTime).toISOString().split('T')[0];
        return meetingDate === today;
      });

      for (const meeting of todaysMeetings) {
        await this.database.upsertMeeting(meeting);
      }

      this.lastParsedTime = new Date();
      this.cachedMeetings = todaysMeetings;
      
      console.log(`Loaded ${todaysMeetings.length} meetings for today`);
      return todaysMeetings;

    } catch (error) {
      console.error('Error loading meetings from Excel:', error);
      throw new Error(`Failed to parse Excel file: ${error.message}`);
    }
  }

  async parseExcelFile(workbook) {
    const meetings = [];
    const sheetNames = workbook.SheetNames;
    
    for (const sheetName of sheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      for (const row of data) {
        const meeting = this.parseMeetingRow(row);
        if (meeting) {
          meetings.push(meeting);
        }
      }
    }

    return meetings;
  }

  parseMeetingRow(row) {
    const titleFields = ['Subject', 'Title', 'Meeting', 'Event', 'Description'];
    const startTimeFields = ['Start', 'Start Time', 'Start Date', 'Date', 'Time'];
    const endTimeFields = ['End', 'End Time', 'End Date', 'Duration'];
    const participantFields = ['Attendees', 'Participants', 'Invitees', 'People'];

    const title = this.findFieldValue(row, titleFields);
    const startTime = this.findFieldValue(row, startTimeFields);
    const endTime = this.findFieldValue(row, endTimeFields);
    const participants = this.findFieldValue(row, participantFields);

    if (!title || !startTime) {
      return null;
    }

    let parsedStartTime;
    let parsedEndTime;

    try {
      parsedStartTime = this.parseDateTime(startTime);
      parsedEndTime = endTime ? this.parseDateTime(endTime) : this.addDefaultDuration(parsedStartTime);
    } catch (error) {
      console.warn(`Failed to parse time for meeting "${title}":`, error);
      return null;
    }

    const participantList = this.parseParticipants(participants);
    const folderName = this.sanitizeFolderName(title);

    return {
      title,
      folderName,
      startTime: parsedStartTime.toISOString(),
      endTime: parsedEndTime.toISOString(),
      participants: participantList
    };
  }

  findFieldValue(row, possibleFields) {
    for (const field of possibleFields) {
      if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
        return row[field];
      }
    }
    return null;
  }

  parseDateTime(dateValue) {
    if (dateValue instanceof Date) {
      return dateValue;
    }

    if (typeof dateValue === 'number') {
      return new Date((dateValue - 25569) * 86400 * 1000);
    }

    if (typeof dateValue === 'string') {
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    throw new Error(`Unable to parse date: ${dateValue}`);
  }

  addDefaultDuration(startTime) {
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + 30);
    return endTime;
  }

  parseParticipants(participantString) {
    if (!participantString) {
      return [];
    }

    if (Array.isArray(participantString)) {
      return participantString;
    }

    const separators = [';', ',', '\n', '|'];
    let participants = [participantString];

    for (const separator of separators) {
      if (participantString.includes(separator)) {
        participants = participantString.split(separator);
        break;
      }
    }

    return participants
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => this.extractEmail(p));
  }

  extractEmail(participant) {
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;
    const match = participant.match(emailRegex);
    return match ? match[1] : participant;
  }

  sanitizeFolderName(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  }

  async refreshMeetings() {
    try {
      await this.loadTodaysMeetings();
      if (global.mainWindow) {
        global.mainWindow.webContents.send('meetings-refreshed');
      }
    } catch (error) {
      console.error('Error refreshing meetings:', error);
      throw error;
    }
  }

  getCachedMeetings() {
    return this.cachedMeetings;
  }

  getLastParsedTime() {
    return this.lastParsedTime;
  }
}

module.exports = MeetingLoader;