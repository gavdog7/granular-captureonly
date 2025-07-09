// Test the 1-day offset fix

function parseExcelDate(excelDate) {
  if (!excelDate) return null;
  
  if (excelDate instanceof Date) {
    return excelDate;
  }
  
  if (typeof excelDate === 'number') {
    // Excel date serial number - use standard Excel epoch (January 1, 1900)
    const excelEpoch = new Date(1900, 0, 1);
    const parsedDate = new Date(excelEpoch.getTime() + (excelDate - 1) * 86400 * 1000);
    
    // Apply 1-day offset to fix the date discrepancy
    const correctedDate = new Date(parsedDate);
    correctedDate.setDate(correctedDate.getDate() - 1);
    
    return correctedDate;
  }
  
  return null;
}

function testOffsetFix() {
  console.log('🔧 Testing 1-Day Offset Fix\n');
  
  const testDates = [45844, 45845, 45846, 45847, 45848, 45849, 45850];
  const today = new Date().toISOString().split('T')[0];
  
  console.log(`📅 Today: ${today}`);
  console.log('\n📅 Excel date parsing with 1-day offset:');
  
  testDates.forEach(excelDate => {
    const parsed = parseExcelDate(excelDate);
    const dateStr = parsed.toISOString().split('T')[0];
    const isToday = dateStr === today;
    console.log(`${excelDate} → ${dateStr} (${parsed.toDateString()}) ${isToday ? '← TODAY' : ''}`);
  });
  
  console.log('\n🎯 Expected Results:');
  console.log('- 45847 should now be July 9, 2025 (today)');
  console.log('- 45848 should now be July 10, 2025 (tomorrow)');
  console.log('- The app should now show meetings for July 9, not July 10');
}

testOffsetFix();