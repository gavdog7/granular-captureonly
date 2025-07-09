// Test different Excel date conversion methods

function testExcelDateConversion() {
  console.log('🔧 Testing Excel Date Conversion Methods\n');
  
  // Known values from the debug - these should represent recent dates
  const testDates = [45844, 45845, 45846, 45847, 45848, 45849, 45850];
  
  console.log('📅 Current method (excelDate - 25569) * 86400 * 1000:');
  testDates.forEach(excelDate => {
    const currentMethod = new Date((excelDate - 25569) * 86400 * 1000);
    console.log(`${excelDate} → ${currentMethod.toISOString().split('T')[0]} (${currentMethod.toDateString()})`);
  });
  
  console.log('\n📅 Alternative method 1 (excelDate - 25569) with UTC:');
  testDates.forEach(excelDate => {
    const altMethod1 = new Date(Date.UTC(1970, 0, excelDate - 25569 + 1));
    console.log(`${excelDate} → ${altMethod1.toISOString().split('T')[0]} (${altMethod1.toDateString()})`);
  });
  
  console.log('\n📅 Alternative method 2 (adjust for 1900 leap year bug):');
  testDates.forEach(excelDate => {
    // Excel incorrectly treats 1900 as a leap year, so we need to subtract 1 for dates after Feb 28, 1900
    const adjustedDate = excelDate > 60 ? excelDate - 1 : excelDate;
    const altMethod2 = new Date((adjustedDate - 25569) * 86400 * 1000);
    console.log(`${excelDate} → ${altMethod2.toISOString().split('T')[0]} (${altMethod2.toDateString()})`);
  });
  
  console.log('\n📅 Alternative method 3 (standard Excel epoch):');
  testDates.forEach(excelDate => {
    // Excel epoch is January 1, 1900, but treating 1900 as leap year
    const excelEpoch = new Date(1900, 0, 1);
    const altMethod3 = new Date(excelEpoch.getTime() + (excelDate - 1) * 86400 * 1000);
    console.log(`${excelDate} → ${altMethod3.toISOString().split('T')[0]} (${altMethod3.toDateString()})`);
  });
  
  console.log('\n📅 Alternative method 4 (corrected Excel epoch):');
  testDates.forEach(excelDate => {
    // Corrected version accounting for 1900 not being a leap year
    const daysSince1900 = excelDate;
    const daysSince1970 = daysSince1900 - 25569; // Days between 1900-01-01 and 1970-01-01
    const altMethod4 = new Date(daysSince1970 * 86400 * 1000);
    console.log(`${excelDate} → ${altMethod4.toISOString().split('T')[0]} (${altMethod4.toDateString()})`);
  });
  
  console.log('\n🎯 Expected dates based on context:');
  console.log('We expect to see dates around July 9-10, 2025');
  console.log('45844 should be around July 8, 2025');
  console.log('45845 should be around July 9, 2025');
  console.log('45846 should be around July 10, 2025');
  
  // Let's reverse engineer: what Excel serial number should July 9, 2025 be?
  const july9_2025 = new Date('2025-07-09');
  const july9_serial = Math.floor((july9_2025.getTime() / 86400000) + 25569);
  console.log(`\n🔍 July 9, 2025 should be Excel serial: ${july9_serial}`);
  
  // Test our current formula with the correct serial
  const testCorrectSerial = new Date((july9_serial - 25569) * 86400 * 1000);
  console.log(`Testing ${july9_serial} → ${testCorrectSerial.toISOString().split('T')[0]}`);
}

testExcelDateConversion();