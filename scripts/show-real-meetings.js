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
  // Handle Excel date formats
  if (excelDate instanceof Date) {
    return excelDate;
  }
  
  if (typeof excelDate === 'number') {
    // Excel date serial number
    return new Date((excelDate - 25569) * 86400 * 1000);
  }
  
  if (typeof excelDate === 'string') {
    // Try to parse string date
    const parsed = new Date(excelDate);
    if (!isNaN(parsed.getTime())) {
      return parsed;
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
  
  // If it's a number (Excel time serial)
  if (typeof timeValue === 'number') {
    // Excel time is a fraction of a day
    const hours = Math.floor(timeValue * 24);
    const minutes = Math.floor((timeValue * 24 * 60) % 60);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
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
    
    // Look for the 6-week meeting forecast tab
    const targetSheet = workbook.SheetNames.find(name => 
      name.toLowerCase().includes('6-week') || 
      name.toLowerCase().includes('forecast') ||
      name.toLowerCase().includes('meeting')
    );
    
    if (!targetSheet) {
      console.log('❌ Could not find "6-week meeting forecast" tab');
      console.log('Available sheets:', workbook.SheetNames);
      return;
    }
    
    console.log(`📊 Using sheet: "${targetSheet}"`);
    
    const worksheet = workbook.Sheets[targetSheet];
    const data = XLSX.utils.sheet_to_json(worksheet, { raw: false });
    
    console.log(`📄 Found ${data.length} rows in the sheet`);
    
    if (data.length > 0) {
      console.log('\n📋 Sample row structure:');
      console.log(JSON.stringify(data[0], null, 2));
    }
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    
    console.log(`\n📅 Today's Date: ${today.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}`);
    console.log(`📅 Looking for meetings on: ${todayStr}`);
    
    // Process and filter meetings
    const todaysMeetings = [];
    
    for (const row of data) {
      // Try to find date and time columns (flexible column names)
      const dateFields = Object.keys(row).filter(key => 
        key.toLowerCase().includes('date') || 
        key.toLowerCase().includes('start') ||
        key.toLowerCase().includes('day')
      );
      
      const timeFields = Object.keys(row).filter(key => 
        key.toLowerCase().includes('time') && 
        !key.toLowerCase().includes('end')
      );
      
      const endTimeFields = Object.keys(row).filter(key => 
        key.toLowerCase().includes('end') && 
        key.toLowerCase().includes('time')
      );
      
      const titleFields = Object.keys(row).filter(key => 
        key.toLowerCase().includes('subject') || 
        key.toLowerCase().includes('title') ||
        key.toLowerCase().includes('meeting') ||
        key.toLowerCase().includes('event')
      );
      
      const participantFields = Object.keys(row).filter(key => 
        key.toLowerCase().includes('attendee') || 
        key.toLowerCase().includes('participant') ||
        key.toLowerCase().includes('people')
      );
      
      // Skip rows without essential data
      if (dateFields.length === 0 || titleFields.length === 0) {
        continue;
      }
      
      const dateValue = row[dateFields[0]];
      const titleValue = row[titleFields[0]];
      const timeValue = timeFields.length > 0 ? row[timeFields[0]] : null;
      const endTimeValue = endTimeFields.length > 0 ? row[endTimeFields[0]] : null;
      const participantValue = participantFields.length > 0 ? row[participantFields[0]] : null;
      
      // Skip empty rows
      if (!dateValue || !titleValue) {
        continue;
      }
      
      // Parse the date
      const meetingDate = parseExcelDate(dateValue);
      if (!meetingDate) {
        continue;
      }
      
      // Check if it's today
      const meetingDateStr = meetingDate.toISOString().split('T')[0];
      if (meetingDateStr !== todayStr) {
        continue;
      }
      
      // Parse times
      const startTime = parseExcelTime(timeValue);
      const endTime = parseExcelTime(endTimeValue);
      
      // If we have a start time, use it; otherwise use a default
      let finalStartTime = startTime || new Date(meetingDate.getTime() + 9 * 60 * 60 * 1000); // 9 AM default
      let finalEndTime = endTime || new Date(finalStartTime.getTime() + 30 * 60 * 1000); // 30 min default
      
      // Set the correct date for the times
      finalStartTime.setFullYear(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
      finalEndTime.setFullYear(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
      
      todaysMeetings.push({
        title: titleValue,
        folderName: sanitizeFolderName(titleValue),
        startTime: finalStartTime,
        endTime: finalEndTime,
        participants: parseParticipants(participantValue),
        rawData: row
      });
    }
    
    console.log(`\n📋 Found ${todaysMeetings.length} meetings for today:\n`);
    
    if (todaysMeetings.length === 0) {
      console.log('   No meetings scheduled for today in the Excel file');
      console.log('\n💡 This could mean:');
      console.log('   - No meetings are scheduled for today');
      console.log('   - The date format in Excel doesn\'t match today\'s date');
      console.log('   - The column names don\'t match our detection logic');
      console.log('\n📊 Available column names in the sheet:');
      if (data.length > 0) {
        Object.keys(data[0]).forEach(key => {
          console.log(`   - "${key}"`);
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