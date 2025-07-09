const XLSX = require('xlsx');
const path = require('path');

function getMeetingStatus(startTime, endTime) {
  const now = new Date();
  
  if (now < startTime) {
    return { class: 'upcoming', text: 'Upcoming' };
  } else if (now >= startTime && now <= endTime) {
    return { class: 'active', text: 'Active' };
  } else {
    return { class: 'past', text: 'Past' };
  }
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function formatDuration(start, end) {
  const durationMs = end.getTime() - start.getTime();
  const durationMinutes = Math.floor(durationMs / (1000 * 60));
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
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

function parseExcelDate(excelDate) {
  if (!excelDate) return null;
  
  // Handle Excel date formats
  if (excelDate instanceof Date) {
    return excelDate;
  }
  
  if (typeof excelDate === 'number') {
    // Excel date serial number (days since 1900-01-01)
    return new Date((excelDate - 25569) * 86400 * 1000);
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

function showRealMeetings() {
  console.log('🚀 Granular CaptureOnly - Real Calendar Data Preview\n');
  console.log('=' .repeat(60));
  
  const excelPath = path.join(__dirname, '../docs/Calendar import xlsx/Calendar management log.xlsx');
  
  try {
    const workbook = XLSX.readFile(excelPath);
    console.log(`📁 Reading Excel file: ${excelPath}`);
    console.log(`📋 Available sheets: ${workbook.SheetNames.join(', ')}`);
    
    // Use the 6-Week Meeting Forecast sheet
    const targetSheet = "6-Week Meeting Forecast";
    const worksheet = workbook.Sheets[targetSheet];
    
    console.log(`📊 Using sheet: "${targetSheet}"`);
    
    // Get the raw data - we know headers are in row 1
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    console.log(`📄 Found ${rawData.length} rows in the sheet`);
    
    // Headers are in row 1
    const headers = rawData[1];
    console.log('📋 Headers:', headers);
    
    // Convert data to objects starting from row 2
    const meetings = [];
    for (let i = 2; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;
      
      const meetingObj = {};
      headers.forEach((header, index) => {
        if (header && row[index] !== undefined) {
          meetingObj[header] = row[index];
        }
      });
      
      meetings.push(meetingObj);
    }
    
    console.log(`📋 Parsed ${meetings.length} meeting records`);
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    
    console.log(`\n📅 Today's Date: ${today.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}`);
    console.log(`📅 Looking for meetings on: ${todayStr}`);
    
    // Process and filter meetings for today
    const todaysMeetings = [];
    
    for (const meeting of meetings) {
      const title = meeting['Meeting Title'];
      const startDate = meeting['Start Date'];
      const startTime = meeting['Start Time'];
      const endTime = meeting['End Time'];
      const participants = meeting['Participants'];
      
      // Skip rows without essential data
      if (!title || !startDate || title.trim() === '') {
        continue;
      }
      
      // Parse the date
      const meetingDate = parseExcelDate(startDate);
      if (!meetingDate) {
        continue;
      }
      
      // Check if it's today
      const meetingDateStr = meetingDate.toISOString().split('T')[0];
      if (meetingDateStr !== todayStr) {
        continue;
      }
      
      // Parse times
      const parsedStartTime = parseExcelTime(startTime);
      const parsedEndTime = parseExcelTime(endTime);
      
      // Create final datetime objects
      let finalStartTime = parsedStartTime || new Date(meetingDate.getTime() + 9 * 60 * 60 * 1000); // 9 AM default
      let finalEndTime = parsedEndTime || new Date(finalStartTime.getTime() + 30 * 60 * 1000); // 30 min default
      
      // Set the correct date for the times
      finalStartTime.setFullYear(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
      finalEndTime.setFullYear(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
      
      todaysMeetings.push({
        title: title,
        folderName: sanitizeFolderName(title),
        startTime: finalStartTime,
        endTime: finalEndTime,
        participants: parseParticipants(participants),
        originalData: meeting
      });
    }
    
    console.log(`\n📋 Found ${todaysMeetings.length} meetings for today:\n`);
    
    if (todaysMeetings.length === 0) {
      console.log('   No meetings scheduled for today in the Excel file');
      console.log('\n💡 Sample of dates found in the sheet:');
      const sampleMeetings = meetings.slice(0, 10)
        .filter(m => m['Meeting Title'] && m['Meeting Title'].trim() !== '')
        .slice(0, 5);
      
      sampleMeetings.forEach(meeting => {
        const date = meeting['Start Date'];
        const parsed = parseExcelDate(date);
        const title = meeting['Meeting Title'];
        console.log(`   "${title}" on "${date}" → ${parsed ? parsed.toISOString().split('T')[0] : 'Could not parse'}`);
      });
      
      // Show what today's date would look like in Excel serial format
      const todaySerial = Math.floor((today.getTime() / 86400000) + 25569);
      console.log(`\n📅 Today's date in Excel serial format: ${todaySerial}`);
      
      // Check if any meetings match today's serial number
      const todaySerialMatches = meetings.filter(m => m['Start Date'] === todaySerial);
      console.log(`📅 Meetings found with today's serial number: ${todaySerialMatches.length}`);
      
      if (todaySerialMatches.length > 0) {
        console.log('📋 Meetings found for today by serial number:');
        todaySerialMatches.forEach(meeting => {
          const title = meeting['Meeting Title'];
          if (title && title.trim() !== '') {
            console.log(`   - "${title}"`);
          }
        });
      }
      
    } else {
      // Sort by start time
      todaysMeetings.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      
      todaysMeetings.forEach((meeting, index) => {
        const status = getMeetingStatus(meeting.startTime, meeting.endTime);
        
        console.log(`${index + 1}. ${meeting.title}`);
        console.log(`   ⏰ ${formatTime(meeting.startTime)} - ${formatTime(meeting.endTime)} (${formatDuration(meeting.startTime, meeting.endTime)})`);
        console.log(`   📊 Status: ${status.text} (${status.class})`);
        console.log(`   📁 Folder: ${meeting.folderName}`);
        
        if (meeting.participants.length > 0) {
          console.log(`   👥 Participants: ${meeting.participants.slice(0, 3).join(', ')}${meeting.participants.length > 3 ? ` and ${meeting.participants.length - 3} more` : ''}`);
        }
        
        console.log('   🎯 Actions Available:');
        console.log(`      - 📝 Notes (always available)`);
        console.log(`      - 🎙️ Record (${status.class === 'active' ? 'available' : 'disabled - only during meeting'})`);
        console.log(`      - 📎 Attach files (always available)`);
        console.log('');
      });
    }
    
    console.log('=' .repeat(60));
    console.log('\n🎯 Next Steps:');
    console.log('1. Use File → Select Excel File to load this calendar');
    console.log('2. The app will automatically filter for today\'s meetings');
    console.log('3. Meeting statuses will update in real-time');
    console.log('\n📱 Current time:', new Date().toLocaleTimeString());
    
  } catch (error) {
    console.error('❌ Error reading Excel file:', error.message);
    console.error('Full error:', error);
  }
}

// Run the script
showRealMeetings();