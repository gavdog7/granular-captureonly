// Test the fixed date parsing

function parseExcelDate(excelDate) {
  if (!excelDate) return null;
  
  if (excelDate instanceof Date) {
    return excelDate;
  }
  
  if (typeof excelDate === 'number') {
    // Excel date serial number - use standard Excel epoch (January 1, 1900)
    const excelEpoch = new Date(1900, 0, 1);
    return new Date(excelEpoch.getTime() + (excelDate - 1) * 86400 * 1000);
  }
  
  return null;
}

function testFixedDates() {
  console.log('✅ Testing Fixed Excel Date Parsing\n');
  
  const testDates = [45844, 45845, 45846, 45847, 45848, 45849, 45850];
  const today = new Date().toISOString().split('T')[0];
  
  console.log(`📅 Today: ${today}`);
  console.log('\n📅 Fixed Excel date parsing:');
  
  testDates.forEach(excelDate => {
    const parsed = parseExcelDate(excelDate);
    const dateStr = parsed.toISOString().split('T')[0];
    const isToday = dateStr === today;
    console.log(`${excelDate} → ${dateStr} (${parsed.toDateString()}) ${isToday ? '← TODAY' : ''}`);
  });
  
  console.log('\n🎯 Expected Results:');
  console.log('- 45846 should be July 9, 2025 (today)');
  console.log('- 45847 should be July 10, 2025 (tomorrow)');
  console.log('- The app should now show meetings for July 9, not July 10');
}

testFixedDates();