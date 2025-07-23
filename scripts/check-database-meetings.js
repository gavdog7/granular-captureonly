const Database = require('../src/database');
const { dateOverride } = require('../src/date-override');

async function checkDatabase() {
  const database = new Database();
  
  try {
    console.log('Today\'s date:', dateOverride.today());
    console.log('Looking for meetings in database...\n');
    
    const meetings = await database.getTodaysMeetings();
    
    console.log(`Found ${meetings.length} meetings in database:`);
    console.log('=' .repeat(80));
    
    meetings.forEach((meeting, index) => {
      console.log(`${index + 1}. ${meeting.title}`);
      console.log(`   Folder: ${meeting.folder_name}`);
      console.log(`   Start: ${meeting.start_time}`);
      console.log(`   Participants: ${meeting.participants}`);
      console.log('');
    });
    
    // Search for specific meetings
    const searchTerms = ['customer story template', 'hiring manager'];
    console.log('\nSearching for specific meetings:');
    
    searchTerms.forEach(term => {
      const found = meetings.filter(m => 
        m.title.toLowerCase().includes(term) ||
        m.folder_name.toLowerCase().includes(term)
      );
      
      if (found.length > 0) {
        console.log(`✅ Found "${term}":`, found.map(m => m.title));
      } else {
        console.log(`❌ Missing "${term}"`);
      }
    });
    
  } catch (error) {
    console.error('Error checking database:', error);
  } finally {
    database.close();
  }
}

checkDatabase();