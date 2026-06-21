const Mocha = require('mocha');
const path = require('path');
const fs = require('fs');

// Initialize Mocha with standard options
const mocha = new Mocha({
  timeout: 35000,
  reporter: 'spec',
  color: true
});

// Test directories representing tiers 1-4
const testTiers = ['tier1', 'tier2', 'tier3', 'tier4'];

testTiers.forEach((tier) => {
  const tierPath = path.join(__dirname, tier);
  if (fs.existsSync(tierPath)) {
    fs.readdirSync(tierPath)
      .filter((file) => file.endsWith('.test.js'))
      .forEach((file) => {
        mocha.addFile(path.join(tierPath, file));
      });
  }
});

// Run tests
console.log('Starting Git Auto-Sync Service E2E Test Suite...');
mocha.run((failures) => {
  process.exitCode = failures ? 1 : 0;
});
