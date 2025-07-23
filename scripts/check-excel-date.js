// Check what date Excel serial 45859 converts to
const excelSerial = 45859;

// Excel epoch is January 1, 1900
const excelEpoch = new Date(1900, 0, 1);
const parsedDate = new Date(excelEpoch.getTime() + (excelSerial - 1) * 86400 * 1000);

console.log('Excel serial:', excelSerial);
console.log('Parsed date:', parsedDate.toISOString());
console.log('Date string:', parsedDate.toDateString());

// Apply the 1-day offset that the code uses
const correctedDate = new Date(parsedDate);
correctedDate.setDate(correctedDate.getDate() - 1);

console.log('\nWith 1-day correction applied:');
console.log('Corrected date:', correctedDate.toISOString());
console.log('Date string:', correctedDate.toDateString());

console.log('\nToday is:', new Date().toDateString());