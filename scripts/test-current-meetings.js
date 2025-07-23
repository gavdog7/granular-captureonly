const MeetingLoader = require('../src/meeting-loader');
const Database = require('../src/database');
const { dateOverride } = require('../src/date-override');

async function testCurrentMeetings() {
  console.log('Testing meeting loading from calendar (4).xlsx...\n');
  
  // Create database and meeting loader
  const database = new Database();
  const meetingLoader = new MeetingLoader(database);
  
  try {
    console.log('Today\'s date:', dateOverride.today());
    
    // Use getAllTodaysMeetings to see all meetings including filtered ones
    console.log('\nGetting ALL meetings from Excel (including filtered):');
    const allMeetings = await meetingLoader.getAllTodaysMeetings();
    
    console.log(`Found ${allMeetings.length} total meetings:\n`);
    
    allMeetings.forEach((meeting, index) => {
      console.log(`${index + 1}. ${meeting.title}`);
      console.log(`   Folder: ${meeting.folder_name}`);
      console.log(`   Start: ${meeting.start_time}`);
      console.log(`   Participants: ${meeting.participants}`);
      console.log('');
    });
    
    // Search for specific meetings
    const searchTerms = ['customer story template', 'hiring manager'];
    console.log('Searching for specific meetings:');
    
    searchTerms.forEach(term => {
      const found = allMeetings.filter(m => 
        m.title.toLowerCase().includes(term) ||
        m.folder_name.toLowerCase().includes(term)
      );
      
      if (found.length > 0) {
        console.log(`✅ Found "${term}":`, found.map(m => m.title));
      } else {
        console.log(`❌ Missing "${term}"`);
      }
    });
    
    // Now test filtered meetings
    console.log('\n' + '='.repeat(60));
    console.log('Getting FILTERED meetings (what app normally shows):');
    
    const filteredMeetings = await meetingLoader.loadMeetingsFromExcel();
    console.log(`Found ${filteredMeetings.length} filtered meetings:\n`);
    
    filteredMeetings.forEach((meeting, index) => {
      console.log(`${index + 1}. ${meeting.title}`);
    });
    
  } catch (error) {
    console.error('Error testing meetings:', error);
  } finally {
    if (database) {
      database.close();
    }
  }
}

testCurrentMeetings();