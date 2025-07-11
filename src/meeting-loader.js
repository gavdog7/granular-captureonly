const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs-extra');
const { dateOverride } = require('./date-override');

class MeetingLoader {
  constructor(database, store, googleDriveService = null) {
    this.database = database;
    this.store = store;
    this.googleDriveService = googleDriveService;
    this.lastParsedTime = null;
    this.cachedMeetings = [];
  }

  async loadTodaysMeetings() {
    const today = dateOverride.today();
    
    // Check if we already have meetings for today
    const existingMeetings = await this.database.getTodaysMeetings();
    
    if (existingMeetings.length > 0) {
      // We have existing meetings for today - use them without re-scraping
      this.cachedMeetings = existingMeetings;
      console.log(`Using existing ${existingMeetings.length} meetings for today (no re-scraping)`);
      return existingMeetings;
    }
    
    // No existing meetings - scrape from Excel (first time today)
    return await this.loadMeetingsFromExcel();
  }

  async loadMeetingsFromExcel() {
    // Look for calendar*.xlsx files in the assets folder
    const projectRoot = path.dirname(__dirname);
    const assetsDir = path.join(projectRoot, 'assets');
    
    // Find calendar files (calendar.xlsx, calendar (1).xlsx, calendar (2).xlsx, etc.)
    const excelFilePath = await this.findCalendarFile(assetsDir);
    
    if (!excelFilePath) {
      throw new Error(`Calendar Excel file not found. Please place a file named 'calendar.xlsx' (or 'calendar (1).xlsx', etc.) in the assets folder at: ${assetsDir}`);
    }
    
    console.log(`📅 Using calendar file: ${excelFilePath}`);

    try {
      const workbook = XLSX.readFile(excelFilePath);
      const meetings = await this.parseCalendarManagementLog(workbook);
      const today = dateOverride.today();
      
      const todaysMeetings = meetings.filter(meeting => {
        const meetingDate = new Date(meeting.startTime).toISOString().split('T')[0];
        return meetingDate === today;
      });

      // For initial load, clear and insert all meetings
      if (this.cachedMeetings.length === 0) {
        for (const meeting of todaysMeetings) {
          await this.database.upsertMeeting(meeting);
        }
      }

      this.lastParsedTime = new Date();
      this.cachedMeetings = todaysMeetings;
      
      console.log(`Loaded ${todaysMeetings.length} meetings for today from Excel`);
      
      // Debug: Show which meetings are being loaded
      console.log('🔍 Debug: Meetings being loaded:');
      todaysMeetings.forEach((meeting, index) => {
        console.log(`${index + 1}. ${meeting.title} (${new Date(meeting.startTime).toDateString()})`);
      });
      
      return todaysMeetings;

    } catch (error) {
      console.error('Error loading meetings from Excel:', error);
      throw new Error(`Failed to parse Excel file: ${error.message}`);
    }
  }

  async refreshMeetingsFromExcel() {
    const existingMeetings = await this.database.getTodaysMeetings();
    const existingFolderNames = new Set(existingMeetings.map(m => m.folder_name));
    
    const newMeetings = await this.loadMeetingsFromExcel();
    
    // Only add meetings that don't already exist (based on folder_name)
    const meetingsToAdd = newMeetings.filter(meeting => 
      !existingFolderNames.has(meeting.folderName)
    );
    
    if (meetingsToAdd.length > 0) {
      for (const meeting of meetingsToAdd) {
        await this.database.upsertMeeting(meeting);
      }
      console.log(`Added ${meetingsToAdd.length} new meetings, preserved ${existingMeetings.length} existing meetings`);
    } else {
      console.log('No new meetings to add');
    }
    
    // Update cached meetings
    this.cachedMeetings = await this.database.getTodaysMeetings();
    
    // Notify renderer of changes
    if (global.mainWindow) {
      global.mainWindow.webContents.send('meetings-refreshed');
    }
    
    return this.cachedMeetings;
  }

  async getAllTodaysMeetings() {
    // Get all meetings for today including filtered ones
    // Use the same file selection logic as loadMeetingsFromExcel
    const projectRoot = path.dirname(__dirname);
    const assetsDir = path.join(projectRoot, 'assets');
    
    // Find calendar files (calendar.xlsx, calendar (1).xlsx, calendar (2).xlsx, etc.)
    const excelFilePath = await this.findCalendarFile(assetsDir);
    
    if (!excelFilePath) {
      throw new Error(`Calendar Excel file not found. Please place a file named 'calendar.xlsx' (or 'calendar (1).xlsx', etc.) in the assets folder at: ${assetsDir}`);
    }
    

    try {
      const workbook = XLSX.readFile(excelFilePath);
      const meetings = await this.parseCalendarManagementLog(workbook, true); // Include filtered meetings
      const today = dateOverride.today();
      
      const todaysMeetings = meetings.filter(meeting => {
        const meetingDate = new Date(meeting.startTime).toISOString().split('T')[0];
        return meetingDate === today;
      });

      // Convert Excel format to database format for renderer compatibility
      const formattedMeetings = todaysMeetings.map((meeting, index) => ({
        id: `excel-${index}`, // Temporary ID for Excel-only meetings
        title: meeting.title,
        folder_name: meeting.folderName,
        start_time: meeting.startTime,
        end_time: meeting.endTime,
        participants: JSON.stringify(meeting.participants || []),
        notes_content: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      console.log(`Found ${formattedMeetings.length} total meetings for today (including filtered)`);
      
      return formattedMeetings;

    } catch (error) {
      console.error('Error loading all meetings from Excel:', error);
      throw new Error(`Failed to parse Excel file: ${error.message}`);
    }
  }

  async parseCalendarManagementLog(workbook, includeFiltered = false) {
    const meetings = [];
    
    // Use the "6-Week Meeting Forecast" sheet specifically
    const targetSheet = "6-Week Meeting Forecast";
    const worksheet = workbook.Sheets[targetSheet];
    
    if (!worksheet) {
      throw new Error(`Sheet "${targetSheet}" not found in Excel file`);
    }

    // Get the raw data - we know headers are in row 1
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Headers are in row 1 (index 1)
    const headers = rawData[1];
    
    // Convert data to objects starting from row 2
    for (let i = 2; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;
      
      const meetingObj = {};
      headers.forEach((header, index) => {
        if (header && row[index] !== undefined) {
          meetingObj[header] = row[index];
        }
      });
      
      const meeting = this.parseCalendarMeetingRow(meetingObj, includeFiltered);
      if (meeting) {
        meetings.push(meeting);
      }
    }

    return meetings;
  }

  parseCalendarMeetingRow(meeting, includeFiltered = false) {
    const title = meeting['Meeting Title'];
    const startDate = meeting['Start Date'];
    const startTime = meeting['Start Time'];
    const endTime = meeting['End Time'];
    const participants = meeting['Participants'];
    const status = meeting['Status'];

    // Skip rows without essential data
    if (!title || !startDate || title.trim() === '') {
      return null;
    }

    // Apply filter: exclude meetings where status is OWNER and participants is blank
    // Unless includeFiltered is true (for show more functionality)
    if (!includeFiltered && status === 'OWNER' && (!participants || participants.trim() === '')) {
      return null;
    }

    // Parse the date
    const meetingDate = this.parseExcelDate(startDate);
    if (!meetingDate) {
      return null;
    }

    // Parse times
    const parsedStartTime = this.parseExcelTime(startTime);
    const parsedEndTime = this.parseExcelTime(endTime);

    // Create final datetime objects
    let finalStartTime = parsedStartTime || new Date(meetingDate.getTime() + 9 * 60 * 60 * 1000); // 9 AM default
    let finalEndTime = parsedEndTime || new Date(finalStartTime.getTime() + 30 * 60 * 1000); // 30 min default

    // Set the correct date for the times
    finalStartTime.setFullYear(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
    finalEndTime.setFullYear(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());

    const participantList = this.parseParticipants(participants);
    const folderName = this.sanitizeFolderName(title);

    return {
      title,
      folderName,
      startTime: finalStartTime.toISOString(),
      endTime: finalEndTime.toISOString(),
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

  parseExcelDate(excelDate) {
    if (!excelDate) return null;
    
    // Handle Excel date formats
    if (excelDate instanceof Date) {
      return excelDate;
    }
    
    if (typeof excelDate === 'number') {
      // Excel date serial number - use standard Excel epoch (January 1, 1900)
      // Excel treats 1900 as a leap year (it's not), so we need to account for this
      const excelEpoch = new Date(1900, 0, 1);
      const parsedDate = new Date(excelEpoch.getTime() + (excelDate - 1) * 86400 * 1000);
      
      // Apply 1-day offset to fix the date discrepancy
      const correctedDate = new Date(parsedDate);
      correctedDate.setDate(correctedDate.getDate() - 1);
      
      return correctedDate;
    }
    
    if (typeof excelDate === 'string') {
      // Try to parse string date formats
      const parsed = new Date(excelDate);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      
      // Try MM/DD/YYYY format
      const dateMatch = excelDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (dateMatch) {
        const month = parseInt(dateMatch[1]) - 1; // JavaScript months are 0-indexed
        const day = parseInt(dateMatch[2]);
        const year = parseInt(dateMatch[3]);
        return new Date(year, month, day);
      }
    }
    
    return null;
  }

  parseExcelTime(timeValue) {
    if (!timeValue) return null;
    
    // If it's already a Date object
    if (timeValue instanceof Date) {
      return timeValue;
    }
    
    // If it's a number (Excel time serial - fraction of a day)
    if (typeof timeValue === 'number') {
      const hours = Math.floor(timeValue * 24);
      const minutes = Math.floor((timeValue * 24 * 60) % 60);
      const seconds = Math.floor((timeValue * 24 * 60 * 60) % 60);
      
      const date = new Date();
      date.setHours(hours, minutes, seconds, 0);
      return date;
    }
    
    // If it's a string, try to parse it
    if (typeof timeValue === 'string') {
      const timeMatch = timeValue.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const ampm = timeMatch[3];
        
        if (ampm && ampm.toUpperCase() === 'PM' && hours !== 12) {
          hours += 12;
        } else if (ampm && ampm.toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
        }
        
        const date = new Date();
        date.setHours(hours, minutes, 0, 0);
        return date;
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
      .filter(p => p.toLowerCase() !== 'none') // Remove None entries
      .filter(p => p.toLowerCase() !== 'tbd') // Remove TBD entries
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
      await this.refreshMeetingsFromExcel();
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

  async findCalendarFile(assetsDir) {
    try {
      // Ensure assets directory exists
      await fs.ensureDir(assetsDir);
      
      // 1. Get local calendar files
      const localFiles = await this.getLocalCalendarFiles(assetsDir);
      
      // Just use local files
      const allFiles = [...localFiles];
      
      if (allFiles.length === 0) {
        console.log(`📂 No calendar*.xlsx files found locally in: ${assetsDir}`);
        return null;
      }
      
      // 4. Sort by most recent modification date (newest first)
      allFiles.sort((a, b) => b.modifiedTime - a.modifiedTime);
      
      const selectedFile = allFiles[0];
      console.log(`📅 Found ${allFiles.length} calendar file(s) across all sources:`);
      allFiles.forEach((file, index) => {
        const marker = index === 0 ? '→' : ' ';
        console.log(`  ${marker} ${file.name} (modified: ${file.modifiedTimeString})`);
      });
      
      console.log(`📅 Using local file: ${selectedFile.name}`);
      return selectedFile.path;
      
    } catch (error) {
      console.error('Error finding calendar file:', error);
      return null;
    }
  }

  async getLocalCalendarFiles(assetsDir) {
    try {
      // Read all files in the assets directory
      const files = await fs.readdir(assetsDir);
      
      // Find files that start with 'calendar' and end with '.xlsx'
      const calendarFiles = files.filter(file => 
        file.toLowerCase().startsWith('calendar') && 
        file.toLowerCase().endsWith('.xlsx')
      );
      
      if (calendarFiles.length === 0) {
        return [];
      }
      
      // Get file stats for local files
      const filesWithStats = await Promise.all(
        calendarFiles.map(async (file) => {
          const filePath = path.join(assetsDir, file);
          const stats = await fs.stat(filePath);
          return {
            name: file,
            path: filePath,
            modifiedTime: stats.mtime,
            modifiedTimeString: stats.mtime.toLocaleString(),
            source: 'local'
          };
        })
      );
      
      return filesWithStats;
      
    } catch (error) {
      console.error('Error getting local calendar files:', error);
      return [];
    }
  }
}

module.exports = MeetingLoader;