const { findGitRepositories } = require('../src/repo-watcher');
const { loadConfig } = require('../src/config-manager');

loadConfig();
console.log('Current Config monitoredRoots:', require('../src/config-manager').getConfig().monitoredRoots);

findGitRepositories().then(repos => {
  console.log('Scanned repos:', repos);
}).catch(err => {
  console.error('Scan error:', err);
});
