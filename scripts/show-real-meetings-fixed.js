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
    // Excel date serial number
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
      name.toLowerCase().includes('forecast')
    );
    
    if (!targetSheet) {
      console.log('❌ Could not find "6-week meeting forecast" tab');
      console.log('Available sheets:', workbook.SheetNames);
      return;
    }
    
    console.log(`📊 Using sheet: "${targetSheet}"`);
    
    const worksheet = workbook.Sheets[targetSheet];
    
    // Get the raw data without headers to better understand the structure
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    console.log(`📄 Sheet range: ${XLSX.utils.encode_range(range)}`);
    
    // Try to parse with header detection
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    console.log(`📄 Found ${rawData.length} rows in the sheet`);
    
    // Find the header row (look for a row that contains "Meeting Title" or similar)
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      if (Array.isArray(row) && row.some(cell => 
        cell && typeof cell === 'string' && 
        (cell.toLowerCase().includes('meeting') || cell.toLowerCase().includes('title'))
      )) {
        headerRowIndex = i;
        break;
      }
    }
    
    if (headerRowIndex === -1) {
      console.log('❌ Could not find header row');
      console.log('First few rows:');
      rawData.slice(0, 5).forEach((row, i) => {
        console.log(`Row ${i}:`, row);
      });
      return;
    }
    
    console.log(`📋 Found header row at index ${headerRowIndex}`);
    const headers = rawData[headerRowIndex];
    console.log('📋 Headers:', headers);
    
    // Convert to objects using the found headers
    const meetings = [];
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
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
    
    if (meetings.length > 0) {
      console.log('\n📋 Sample meeting structure:');
      const sampleMeeting = meetings.find(m => Object.keys(m).length > 2) || meetings[0];
      console.log(JSON.stringify(sampleMeeting, null, 2));
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
    
    // Find column mappings
    const titleColumn = headers.find(h => h && h.toLowerCase().includes('title'));
    const startDateColumn = headers.find(h => h && h.toLowerCase().includes('start') && h.toLowerCase().includes('date'));
    const startTimeColumn = headers.find(h => h && h.toLowerCase().includes('start') && h.toLowerCase().includes('time'));
    const endTimeColumn = headers.find(h => h && h.toLowerCase().includes('end') && h.toLowerCase().includes('time'));
    const participantsColumn = headers.find(h => h && h.toLowerCase().includes('participant'));
    
    console.log(`📋 Column mappings:`);
    console.log(`   Title: "${titleColumn}"`);
    console.log(`   Start Date: "${startDateColumn}"`);
    console.log(`   Start Time: "${startTimeColumn}"`);
    console.log(`   End Time: "${endTimeColumn}"`);
    console.log(`   Participants: "${participantsColumn}"`);
    
    // Process and filter meetings
    const todaysMeetings = [];
    
    for (const meeting of meetings) {
      const title = meeting[titleColumn];
      const startDate = meeting[startDateColumn];
      const startTime = meeting[startTimeColumn];
      const endTime = meeting[endTimeColumn];
      const participants = meeting[participantsColumn];
      
      // Skip rows without essential data
      if (!title || !startDate) {
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
      console.log('\n💡 This could mean:');
      console.log('   - No meetings are scheduled for today');
      console.log('   - The date format in Excel doesn\'t match today\'s date');
      console.log('\n📊 Sample of dates found in the sheet:');
      const sampleDates = meetings.slice(0, 10)
        .map(m => m[startDateColumn])
        .filter(d => d)
        .slice(0, 5);
      sampleDates.forEach(date => {
        const parsed = parseExcelDate(date);
        console.log(`   "${date}" → ${parsed ? parsed.toISOString().split('T')[0] : 'Could not parse'}`);
      });
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