const XLSX = require('xlsx');
const path = require('path');

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

function debugDateFiltering() {
  console.log('🔍 Debugging Date Filtering Issue\n');
  console.log('=' .repeat(60));
  
  const excelPath = path.join(__dirname, '../docs/Calendar import xlsx/Calendar management log.xlsx');
  
  try {
    const workbook = XLSX.readFile(excelPath);
    const targetSheet = "6-Week Meeting Forecast";
    const worksheet = workbook.Sheets[targetSheet];
    
    // Get the raw data
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const headers = rawData[1];
    
    console.log('📅 Current System Date Information:');
    const now = new Date();
    console.log(`   JavaScript Date: ${now}`);
    console.log(`   ISO String: ${now.toISOString()}`);
    console.log(`   Today String (YYYY-MM-DD): ${now.toISOString().split('T')[0]}`);
    console.log(`   Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    console.log(`   Timezone Offset: ${now.getTimezoneOffset()} minutes`);
    
    // Today's date for comparison
    const todayStr = now.toISOString().split('T')[0];
    console.log(`\n📅 Looking for meetings on: ${todayStr}`);
    
    // Sample some meetings to see what dates we're getting
    console.log('\n📋 Sample meeting dates from Excel:');
    
    const sampleMeetings = [];
    for (let i = 2; i < Math.min(20, rawData.length); i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;
      
      const meetingObj = {};
      headers.forEach((header, index) => {
        if (header && row[index] !== undefined) {
          meetingObj[header] = row[index];
        }
      });
      
      const title = meetingObj['Meeting Title'];
      const startDate = meetingObj['Start Date'];
      const status = meetingObj['Status'];
      const participants = meetingObj['Participants'];
      
      if (title && startDate && title.trim() !== '') {
        // Apply the same filter as the app
        const shouldInclude = !(status === 'OWNER' && (!participants || participants.trim() === ''));
        
        if (shouldInclude) {
          const parsedDate = parseExcelDate(startDate);
          if (parsedDate) {
            const meetingDateStr = parsedDate.toISOString().split('T')[0];
            sampleMeetings.push({
              title,
              startDate,
              parsedDate,
              meetingDateStr,
              isToday: meetingDateStr === todayStr
            });
          }
        }
      }
    }
    
    // Show sample meetings
    sampleMeetings.slice(0, 10).forEach((meeting, index) => {
      console.log(`${index + 1}. "${meeting.title}"`);
      console.log(`   Excel Date: ${meeting.startDate}`);
      console.log(`   Parsed Date: ${meeting.parsedDate}`);
      console.log(`   Date String: ${meeting.meetingDateStr}`);
      console.log(`   Is Today: ${meeting.isToday}`);
      console.log('');
    });
    
    // Count meetings by date
    const meetingsByDate = {};
    sampleMeetings.forEach(meeting => {
      const dateStr = meeting.meetingDateStr;
      if (!meetingsByDate[dateStr]) {
        meetingsByDate[dateStr] = [];
      }
      meetingsByDate[dateStr].push(meeting.title);
    });
    
    console.log('📊 Meeting counts by date:');
    Object.keys(meetingsByDate).sort().forEach(date => {
      const count = meetingsByDate[date].length;
      const isToday = date === todayStr;
      console.log(`   ${date}: ${count} meetings ${isToday ? '← TODAY' : ''}`);
    });
    
    // Show today's meetings specifically
    const todaysMeetings = sampleMeetings.filter(m => m.isToday);
    console.log(`\n📋 Today's meetings (${todaysMeetings.length}):`)
    todaysMeetings.forEach((meeting, index) => {
      console.log(`${index + 1}. ${meeting.title}`);
    });
    
    // Check if there are meetings for July 10
    const july10 = '2025-07-10';
    const july10Meetings = sampleMeetings.filter(m => m.meetingDateStr === july10);
    console.log(`\n📋 July 10 meetings (${july10Meetings.length}):`)
    july10Meetings.forEach((meeting, index) => {
      console.log(`${index + 1}. ${meeting.title}`);
    });
    
    // Check timezone issues
    console.log('\n🕐 Timezone Analysis:');
    if (july10Meetings.length > 0) {
      const firstJuly10 = july10Meetings[0];
      console.log(`Sample July 10 meeting: "${firstJuly10.title}"`);
      console.log(`Excel date value: ${firstJuly10.startDate}`);
      console.log(`Parsed date: ${firstJuly10.parsedDate}`);
      console.log(`Parsed date UTC: ${firstJuly10.parsedDate.toISOString()}`);
      console.log(`Parsed date local: ${firstJuly10.parsedDate.toLocaleString()}`);
      
      // Check what happens if we adjust for timezone
      const localDate = new Date(firstJuly10.parsedDate.getTime() + (firstJuly10.parsedDate.getTimezoneOffset() * 60000));
      console.log(`Timezone-adjusted date: ${localDate.toISOString().split('T')[0]}`);
    }
    
    console.log('\n💡 Possible Issues:');
    console.log('1. Excel date parsing might have timezone offset issues');
    console.log('2. The filter might be working correctly but showing wrong day');
    console.log('3. System date might be different from expected');
    console.log('4. Excel serial date conversion might be off by a day');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the debug
debugDateFiltering();