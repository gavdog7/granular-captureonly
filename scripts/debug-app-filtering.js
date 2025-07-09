const XLSX = require('xlsx');
const path = require('path');

// Copy the exact same functions from meeting-loader.js
function parseExcelDate(excelDate) {
  if (!excelDate) return null;
  
  if (excelDate instanceof Date) {
    return excelDate;
  }
  
  if (typeof excelDate === 'number') {
    // Excel date serial number - use standard Excel epoch (January 1, 1900)
    const excelEpoch = new Date(1900, 0, 1);
    return new Date(excelEpoch.getTime() + (excelDate - 1) * 86400 * 1000);
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

function parseExcelTime(timeValue) {
  if (!timeValue) return null;
  
  if (timeValue instanceof Date) {
    return timeValue;
  }
  
  if (typeof timeValue === 'number') {
    const hours = Math.floor(timeValue * 24);
    const minutes = Math.floor((timeValue * 24 * 60) % 60);
    const seconds = Math.floor((timeValue * 24 * 60 * 60) % 60);
    
    const date = new Date();
    date.setHours(hours, minutes, seconds, 0);
    return date;
  }
  
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

function parseParticipants(participantString) {
  if (!participantString) return [];
  
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
    .filter(p => p.length > 0);
}

function sanitizeFolderName(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

function debugAppFiltering() {
  console.log('🔍 Debugging App Filtering Logic\n');
  console.log('=' .repeat(60));
  
  const excelPath = path.join(__dirname, '../docs/Calendar import xlsx/Calendar management log.xlsx');
  
  try {
    const workbook = XLSX.readFile(excelPath);
    const targetSheet = "6-Week Meeting Forecast";
    const worksheet = workbook.Sheets[targetSheet];
    
    // Get the raw data - exactly like the app does
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const headers = rawData[1];
    
    console.log('📋 Headers:', headers);
    console.log('');
    
    // Convert data to objects starting from row 2 - exactly like the app
    const allMeetings = [];
    for (let i = 2; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;
      
      const meetingObj = {};
      headers.forEach((header, index) => {
        if (header && row[index] !== undefined) {
          meetingObj[header] = row[index];
        }
      });
      
      allMeetings.push(meetingObj);
    }
    
    console.log(`📊 Total meetings in Excel: ${allMeetings.length}`);
    
    // Apply the exact same parsing logic as the app
    const parsedMeetings = [];
    for (const meeting of allMeetings) {
      const title = meeting['Meeting Title'];
      const startDate = meeting['Start Date'];
      const startTime = meeting['Start Time'];
      const endTime = meeting['End Time'];
      const participants = meeting['Participants'];
      const status = meeting['Status'];

      // Skip rows without essential data
      if (!title || !startDate || title.trim() === '') {
        continue;
      }

      // Apply filter: exclude meetings where status is OWNER and participants is blank
      if (status === 'OWNER' && (!participants || participants.trim() === '')) {
        continue;
      }

      // Parse the date
      const meetingDate = parseExcelDate(startDate);
      if (!meetingDate) {
        continue;
      }

      // Parse times
      const parsedStartTime = parseExcelTime(startTime);
      const parsedEndTime = parseExcelTime(endTime);

      // Create final datetime objects
      let finalStartTime = parsedStartTime || new Date(meetingDate.getTime() + 9 * 60 * 60 * 1000);
      let finalEndTime = parsedEndTime || new Date(finalStartTime.getTime() + 30 * 60 * 1000);

      // Set the correct date for the times
      finalStartTime.setFullYear(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
      finalEndTime.setFullYear(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());

      const participantList = parseParticipants(participants);
      const folderName = sanitizeFolderName(title);

      parsedMeetings.push({
        title,
        folderName,
        startTime: finalStartTime.toISOString(),
        endTime: finalEndTime.toISOString(),
        participants: participantList,
        originalStartDate: startDate,
        originalMeetingDate: meetingDate,
        meetingDateString: meetingDate.toISOString().split('T')[0]
      });
    }
    
    console.log(`📊 Meetings after parsing and filtering: ${parsedMeetings.length}`);
    
    // Apply today filter - exactly like the app
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Today's date: ${today}`);
    
    const todaysMeetings = parsedMeetings.filter(meeting => {
      const meetingDate = new Date(meeting.startTime).toISOString().split('T')[0];
      return meetingDate === today;
    });
    
    console.log(`📊 Meetings for today: ${todaysMeetings.length}`);
    console.log('');
    
    // Show the meetings that are being returned
    console.log('🎯 Meetings being returned by app logic:');
    todaysMeetings.forEach((meeting, index) => {
      const startTime = new Date(meeting.startTime);
      const endTime = new Date(meeting.endTime);
      
      console.log(`${index + 1}. ${meeting.title}`);
      console.log(`   Excel Start Date: ${meeting.originalStartDate}`);
      console.log(`   Parsed Meeting Date: ${meeting.originalMeetingDate.toDateString()}`);
      console.log(`   Meeting Date String: ${meeting.meetingDateString}`);
      console.log(`   Start Time: ${startTime.toLocaleString()}`);
      console.log(`   End Time: ${endTime.toLocaleString()}`);
      console.log(`   Participants: ${meeting.participants.length} (${meeting.participants.join(', ')})`);
      console.log('');
    });
    
    // Let's also check what dates we're finding
    console.log('📊 All dates found in parsed meetings:');
    const dateGroups = {};
    parsedMeetings.forEach(meeting => {
      const dateStr = meeting.meetingDateString;
      if (!dateGroups[dateStr]) {
        dateGroups[dateStr] = [];
      }
      dateGroups[dateStr].push(meeting.title);
    });
    
    Object.keys(dateGroups).sort().forEach(date => {
      const isToday = date === today;
      console.log(`   ${date}: ${dateGroups[date].length} meetings ${isToday ? '← TODAY' : ''}`);
    });
    
    console.log('\n🔍 Key Debug Info:');
    console.log(`- System date: ${new Date().toISOString()}`);
    console.log(`- Today string: ${today}`);
    console.log(`- App is looking for meetings on: ${today}`);
    console.log(`- App found ${todaysMeetings.length} meetings for today`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the debug
debugAppFiltering();