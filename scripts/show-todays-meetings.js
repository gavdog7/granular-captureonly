const Database = require('../src/database');
const MeetingLoader = require('../src/meeting-loader');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs-extra');

// Mock electron app for testing
const mockApp = {
  getPath: (type) => {
    if (type === 'userData') return path.join(__dirname, '../temp');
    if (type === 'desktop') return path.join(__dirname, '../temp');
    return __dirname;
  }
};

// Mock electron store
class MockStore {
  constructor() {
    this.data = {
      excelFilePath: null,
      audioQuality: 'medium',
      exportRetentionDays: 7,
      autoRefreshMeetings: true,
      manualExportPath: path.join(__dirname, '../temp/GranularExports'),
      exportTime: '18:00',
      autoExport: false,
      googleDriveFolderId: null
    };
  }

  get(key, defaultValue) {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
  }
}

// Set up mock environment
global.app = mockApp;

// Mock require for electron
const originalRequire = require;
require = function(id) {
  if (id === 'electron') {
    return { app: mockApp };
  }
  return originalRequire(id);
};

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
  
  return excelPath;
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

async function showTodaysMeetings() {
  try {
    console.log('🚀 Granular CaptureOnly - Today\'s Meetings Preview\n');
    console.log('=' .repeat(60));
    
    // Create sample Excel file
    const excelPath = createSampleExcelFile();
    console.log(`📁 Created sample Excel file: ${excelPath}`);
    
    // Initialize database
    const database = new Database();
    await database.initialize();
    console.log('✅ Database initialized');
    
    // Initialize meeting loader
    const store = new MockStore();
    store.set('excelFilePath', excelPath);
    const meetingLoader = new MeetingLoader(database, store);
    
    // Load meetings
    console.log('📊 Loading meetings from Excel...');
    const meetings = await meetingLoader.loadTodaysMeetings();
    
    // Get meetings from database
    const todaysMeetings = await database.getTodaysMeetings();
    
    console.log(`\n📅 Today's Date: ${new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}`);
    
    console.log(`\n📋 Found ${todaysMeetings.length} meetings for today:\n`);
    
    if (todaysMeetings.length === 0) {
      console.log('   No meetings scheduled for today');
    } else {
      // Sort meetings by start time
      const sortedMeetings = todaysMeetings.sort((a, b) => 
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );
      
      sortedMeetings.forEach((meeting, index) => {
        const startTime = new Date(meeting.start_time);
        const endTime = new Date(meeting.end_time);
        const status = getMeetingStatus(startTime, endTime);
        const participants = meeting.participants ? JSON.parse(meeting.participants) : [];
        
        console.log(`${index + 1}. ${meeting.title}`);
        console.log(`   ⏰ ${formatTime(startTime)} - ${formatTime(endTime)} (${formatDuration(startTime, endTime)})`);
        console.log(`   📊 Status: ${status.text} (${status.class})`);
        console.log(`   📁 Folder: ${meeting.folder_name}`);
        
        if (participants.length > 0) {
          console.log(`   👥 Participants: ${participants.slice(0, 3).join(', ')}${participants.length > 3 ? ` and ${participants.length - 3} more` : ''}`);
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
    console.log('1. Select an Excel file with your meetings using File → Select Excel File');
    console.log('2. Use the Refresh button to reload meetings');
    console.log('3. Click on meetings to select them');
    console.log('4. Use the action buttons for Notes, Recording, and Attachments');
    console.log('\n💡 Note: Recording is only available during active meetings');
    console.log('📱 The app will automatically update meeting statuses every 30 seconds');
    
    // Clean up
    await database.close();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  showTodaysMeetings();
}

module.exports = showTodaysMeetings;