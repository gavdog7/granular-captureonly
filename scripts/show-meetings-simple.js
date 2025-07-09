const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs-extra');

function createSampleExcelFile() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  
  // Create sample meetings for today
  const meetings = [
    {
      Subject: "Daily Standup",
      Start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0), // 9:00 AM
      End: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 30),   // 9:30 AM
      Attendees: "john@company.com; jane@company.com; bob@company.com"
    },
    {
      Subject: "Client Review Meeting",
      Start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0), // 2:00 PM
      End: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 30),  // 3:30 PM
      Attendees: "client@external.com; project.manager@company.com; lead.dev@company.com"
    },
    {
      Subject: "Team Retrospective",
      Start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 16, 0), // 4:00 PM
      End: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 17, 0),   // 5:00 PM
      Attendees: "team@company.com; scrum.master@company.com"
    },
    {
      Subject: "Sprint Planning",
      Start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0), // 10:00 AM
      End: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0),   // 12:00 PM
      Attendees: "dev.team@company.com; product.owner@company.com"
    },
    // Add a meeting for tomorrow (should not appear)
    {
      Subject: "Tomorrow's Meeting",
      Start: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 10, 0),
      End: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 11, 0),
      Attendees: "future@company.com"
    }
  ];

  // Create workbook and worksheet
  const worksheet = XLSX.utils.json_to_sheet(meetings);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Meetings');

  // Ensure temp directory exists
  const tempDir = path.join(__dirname, '../temp');
  fs.ensureDirSync(tempDir);

  // Write Excel file
  const excelPath = path.join(tempDir, 'sample-meetings.xlsx');
  XLSX.writeFile(workbook, excelPath);
  
  return { excelPath, meetings };
}

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

function processMeetings(rawMeetings) {
  const today = new Date().toISOString().split('T')[0];
  
  return rawMeetings
    .filter(meeting => {
      const meetingDate = new Date(meeting.Start).toISOString().split('T')[0];
      return meetingDate === today;
    })
    .map(meeting => ({
      title: meeting.Subject,
      folderName: sanitizeFolderName(meeting.Subject),
      startTime: meeting.Start,
      endTime: meeting.End,
      participants: parseParticipants(meeting.Attendees)
    }))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

function showTodaysMeetings() {
  console.log('🚀 Granular CaptureOnly - Today\'s Meetings Preview\n');
  console.log('=' .repeat(60));
  
  // Create sample Excel file
  const { excelPath, meetings: rawMeetings } = createSampleExcelFile();
  console.log(`📁 Created sample Excel file: ${excelPath}`);
  
  // Process meetings (simulate what the app would do)
  const todaysMeetings = processMeetings(rawMeetings);
  
  console.log(`\n📅 Today's Date: ${new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })}`);
  
  console.log(`\n📊 Raw meetings in Excel: ${rawMeetings.length}`);
  console.log(`📋 Meetings for today: ${todaysMeetings.length}\n`);
  
  if (todaysMeetings.length === 0) {
    console.log('   No meetings scheduled for today');
  } else {
    todaysMeetings.forEach((meeting, index) => {
      const startTime = new Date(meeting.startTime);
      const endTime = new Date(meeting.endTime);
      const status = getMeetingStatus(startTime, endTime);
      
      console.log(`${index + 1}. ${meeting.title}`);
      console.log(`   ⏰ ${formatTime(startTime)} - ${formatTime(endTime)} (${formatDuration(startTime, endTime)})`);
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
  console.log('\n🎯 How the app works:');
  console.log('1. Select an Excel file with your meetings using File → Select Excel File');
  console.log('2. Use the Refresh button to reload meetings');
  console.log('3. Click on meetings to select them');
  console.log('4. Use the action buttons for Notes, Recording, and Attachments');
  console.log('\n💡 Features:');
  console.log('- Recording is only available during active meetings');
  console.log('- Meeting statuses update automatically every 30 seconds');
  console.log('- All data is stored in SQLite database');
  console.log('- Supports flexible Excel formats (Subject/Title, Start/Start Time, End/End Time, Attendees/Participants)');
  console.log('\n📱 Current time:', new Date().toLocaleTimeString());
}

// Run the script
showTodaysMeetings();