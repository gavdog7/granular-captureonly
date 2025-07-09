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
    
    // Try YYYY-MM-DD format
    const isoMatch = excelDate.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1]);
      const month = parseInt(isoMatch[2]) - 1;
      const day = parseInt(isoMatch[3]);
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
    
    // Get the raw data to better understand the structure
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    console.log(`📄 Found ${rawData.length} rows in the sheet`);
    
    // Let's examine the first several rows to understand the structure
    console.log('\n📋 First 10 rows structure:');
    rawData.slice(0, 10).forEach((row, i) => {
      console.log(`Row ${i}: [${row.map(cell => `"${cell}"`).join(', ')}]`);
    });
    
    // Find the actual header row by looking for a row that has multiple meaningful columns
    let headerRowIndex = -1;
    let actualHeaders = [];
    
    for (let i = 0; i < Math.min(15, rawData.length); i++) {
      const row = rawData[i];
      if (Array.isArray(row) && row.length > 5) {
        // Check if this row has multiple non-empty cells that look like headers
        const nonEmptyCells = row.filter(cell => cell && cell.toString().trim().length > 0);
        if (nonEmptyCells.length >= 4) {
          // Check if it contains typical header terms
          const hasHeaders = row.some(cell => 
            cell && typeof cell === 'string' && 
            (cell.toLowerCase().includes('title') || 
             cell.toLowerCase().includes('date') || 
             cell.toLowerCase().includes('time') ||
             cell.toLowerCase().includes('participant'))
          );
          
          if (hasHeaders) {
            headerRowIndex = i;
            actualHeaders = row;
            break;
          }
        }
      }
    }
    
    if (headerRowIndex === -1) {
      console.log('\n❌ Could not find header row automatically');
      console.log('🔍 Let me try to look for meetings by column position...');
      
      // Try to parse assuming standard column positions
      // Column 0: Title, Column 2: Start Date, Column 4: Start Time, Column 5: End Time, Column 6: Participants
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const todaysMeetings = [];
      
      // Skip first few rows that might be headers
      for (let i = 3; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length < 3) continue;
        
        const title = row[0];
        const startDate = row[2];
        
        if (!title || !startDate) continue;
        
        const meetingDate = parseExcelDate(startDate);
        if (!meetingDate) continue;
        
        const meetingDateStr = meetingDate.toISOString().split('T')[0];
        if (meetingDateStr !== todayStr) continue;
        
        const startTime = parseExcelTime(row[4]);
        const endTime = parseExcelTime(row[5]);
        const participants = row[6];
        
        let finalStartTime = startTime || new Date(meetingDate.getTime() + 9 * 60 * 60 * 1000);
        let finalEndTime = endTime || new Date(finalStartTime.getTime() + 30 * 60 * 1000);
        
        finalStartTime.setFullYear(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
        finalEndTime.setFullYear(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
        
        todaysMeetings.push({
          title: title.toString(),
          folderName: sanitizeFolderName(title.toString()),
          startTime: finalStartTime,
          endTime: finalEndTime,
          participants: parseParticipants(participants),
          rawRow: row
        });
      }
      
      console.log(`\n📋 Found ${todaysMeetings.length} meetings for today using column positions:\n`);
      
      if (todaysMeetings.length === 0) {
        console.log('   No meetings found for today');
        console.log('\n📊 Sample of data found in the sheet:');
        rawData.slice(3, 8).forEach((row, i) => {
          if (row && row.length > 2) {
            const title = row[0];
            const date = row[2];
            const parsed = parseExcelDate(date);
            console.log(`   Row ${i + 3}: "${title}" on "${date}" → ${parsed ? parsed.toISOString().split('T')[0] : 'Could not parse'}`);
          }
        });
      } else {
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
      console.log('\n📅 Today\'s Date:', today.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }));
      console.log('📅 Looking for meetings on:', todayStr);
      console.log('\n🎯 Next Steps:');
      console.log('1. Use File → Select Excel File to load this calendar');
      console.log('2. The app will automatically filter for today\'s meetings');
      console.log('3. Meeting statuses will update in real-time');
      console.log('\n📱 Current time:', new Date().toLocaleTimeString());
      
      return;
    }
    
    console.log(`\n📋 Found header row at index ${headerRowIndex}`);
    console.log('📋 Headers:', actualHeaders);
    
    // Process the rest of the logic with proper headers...
    
  } catch (error) {
    console.error('❌ Error reading Excel file:', error.message);
    console.error('Full error:', error);
  }
}

// Run the script
showRealMeetings();