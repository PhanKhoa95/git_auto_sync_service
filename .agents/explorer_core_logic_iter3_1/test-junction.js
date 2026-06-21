const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const jPath = path.join(__dirname, 'temp_junction');
const targetPath = __dirname;

try {
  // Create junction
  child_process.execSync(`cmd.exe /c mklink /j "${jPath}" "${targetPath}"`);
  
  const lstat = fs.lstatSync(jPath);
  const stat = fs.statSync(jPath);
  
  console.log('lstat - isSymbolicLink:', lstat.isSymbolicLink());
  console.log('lstat - isDirectory:', lstat.isDirectory());
  console.log('stat - isSymbolicLink:', stat.isSymbolicLink());
  console.log('stat - isDirectory:', stat.isDirectory());
} catch (err) {
  console.error('Error:', err.message);
} finally {
  try {
    fs.rmdirSync(jPath);
  } catch (e) {}
}
