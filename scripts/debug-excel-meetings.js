const XLSX = require('xlsx');
const path = require('path');

// Read the calendar file
const filePath = path.join(__dirname, '..', 'assets', 'calendar (4).xlsx');
console.log('Reading file:', filePath);

try {
  const workbook = XLSX.readFile(filePath);
  
  // List all sheet names
  console.log('\nAvailable sheets:', workbook.SheetNames);
  
  // Read the 6-Week Meeting Forecast sheet
  const worksheet = workbook.Sheets['6-Week Meeting Forecast'];
  if (!worksheet) {
    console.log('ERROR: "6-Week Meeting Forecast" sheet not found!');
    process.exit(1);
  }
  
  // Get raw data
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  // Show headers (row 1)
  console.log('\nHeaders:', rawData[1]);
  
  // Parse meetings and look for the specific ones mentioned
  const searchTerms = ['customer story template', 'hiring manager'];
  
  console.log('\nSearching for meetings containing:', searchTerms);
  console.log('=' .repeat(80));
  
  let foundCount = 0;
  
  // Start from row 2 (after headers)
  for (let i = 2; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;
    
    // Create object from row
    const headers = rawData[1];
    const meetingObj = {};
    headers.forEach((header, index) => {
      if (header && row[index] !== undefined) {
        meetingObj[header] = row[index];
      }
    });
    
    const title = meetingObj['Meeting Title'] || '';
    const startDate = meetingObj['Start Date'];
    const status = meetingObj['Status'];
    const participants = meetingObj['Participants'];
    
    // Check if this meeting matches our search
    const titleLower = title.toLowerCase();
    const matches = searchTerms.some(term => titleLower.includes(term));
    
    if (matches) {
      foundCount++;
      console.log(`\nFound meeting #${foundCount}:`);
      console.log('  Title:', title);
      console.log('  Date:', startDate);
      console.log('  Status:', status);
      console.log('  Participants:', participants || '(none)');
      
      // Check if it would be filtered out
      if (status === 'OWNER' && (!participants || participants.trim() === '')) {
        console.log('  ⚠️  This meeting would be FILTERED OUT (Status=OWNER, no participants)');
      } else {
        console.log('  ✅ This meeting should be included');
      }
    }
  }
  
  if (foundCount === 0) {
    console.log('\nNo meetings found matching the search terms');
  }
  
  // Also show today's date for reference
  console.log('\n' + '=' .repeat(80));
  console.log('Today\'s date:', new Date().toISOString().split('T')[0]);
  
} catch (error) {
  console.error('Error reading Excel file:', error);
}