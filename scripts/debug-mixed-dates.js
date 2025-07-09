const XLSX = require('xlsx');
const path = require('path');

// Use the same parseExcelDate function with offset
function parseExcelDate(excelDate) {
  if (!excelDate) return null;
  
  if (excelDate instanceof Date) {
    return excelDate;
  }
  
  if (typeof excelDate === 'number') {
    // Excel date serial number - use standard Excel epoch (January 1, 1900)
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

function debugMixedDates() {
  console.log('🔍 Debugging Mixed Dates Issue\n');
  console.log('=' .repeat(60));
  
  const excelPath = path.join(__dirname, '../docs/Calendar import xlsx/Calendar management log.xlsx');
  
  try {
    const workbook = XLSX.readFile(excelPath);
    const targetSheet = "6-Week Meeting Forecast";
    const worksheet = workbook.Sheets[targetSheet];
    
    // Get the raw data - exactly like the app does
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const headers = rawData[1];
    
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
        meetingDateString: meetingDate.toISOString().split('T')[0],
        finalStartTimeString: finalStartTime.toISOString().split('T')[0]
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
    
    // Show all meetings that are being returned
    console.log('🎯 All meetings being returned by app logic:');
    todaysMeetings.forEach((meeting, index) => {
      const startTime = new Date(meeting.startTime);
      const endTime = new Date(meeting.endTime);
      
      console.log(`${index + 1}. ${meeting.title}`);
      console.log(`   Excel Start Date: ${meeting.originalStartDate}`);
      console.log(`   Parsed Meeting Date: ${meeting.originalMeetingDate.toDateString()}`);
      console.log(`   Meeting Date String: ${meeting.meetingDateString}`);
      console.log(`   Final Start Time: ${startTime.toLocaleString()}`);
      console.log(`   Final Start Time String: ${meeting.finalStartTimeString}`);
      console.log(`   Participants: ${meeting.participants.length} (${meeting.participants.join(', ')})`);
      console.log('');
    });
    
    // Let's group by actual date to see what's happening
    console.log('📊 Meetings grouped by final date:');
    const dateGroups = {};
    parsedMeetings.forEach(meeting => {
      const dateStr = meeting.finalStartTimeString;
      if (!dateGroups[dateStr]) {
        dateGroups[dateStr] = [];
      }
      dateGroups[dateStr].push(meeting.title);
    });
    
    Object.keys(dateGroups).sort().forEach(date => {
      const isToday = date === today;
      console.log(`   ${date}: ${dateGroups[date].length} meetings ${isToday ? '← TODAY' : ''}`);
    });
    
    // Check for timezone issues
    console.log('\n🕐 Timezone Issue Check:');
    console.log(`- System timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    console.log(`- System timezone offset: ${new Date().getTimezoneOffset()} minutes`);
    
    const sampleMeeting = todaysMeetings[0];
    if (sampleMeeting) {
      console.log(`- Sample meeting start time: ${sampleMeeting.startTime}`);
      console.log(`- Sample meeting local time: ${new Date(sampleMeeting.startTime).toLocaleString()}`);
      console.log(`- Sample meeting UTC date: ${new Date(sampleMeeting.startTime).toISOString().split('T')[0]}`);
    }
    
    console.log('\n🔍 Potential Issues:');
    console.log('1. Time zone conversion might be affecting date calculation');
    console.log('2. Some meetings might span midnight');
    console.log('3. Date offset might be applied inconsistently');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the debug
debugMixedDates();