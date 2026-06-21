const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const E2ETestHarness = require('./e2e/harness');

function getMemoryUsage(pid) {
  try {
    const output = execSync(`tasklist /NH /FI "PID eq ${pid}" /FO csv`, { encoding: 'utf8' }).trim();
    // Output format: "node.exe","12345","Console","1","45,212 K"
    const parts = output.split(',');
    if (parts.length >= 5) {
      const memStr = parts[4].replace(/"/g, '').replace(/ K/g, '').replace(/,/g, '').trim();
      return parseInt(memStr, 10); // in KB
    }
  } catch (e) {}
  
  try {
    const output = execSync(`wmic process where processid=${pid} get WorkingSetSize`, { encoding: 'utf8' }).trim();
    const lines = output.split(/\r?\n/);
    if (lines.length >= 2) {
      const bytes = parseInt(lines[1].trim(), 10);
      return Math.round(bytes / 1024); // in KB
    }
  } catch (e) {}

  return null;
}

function getRunningProcesses(imageName) {
  try {
    const output = execSync(`tasklist /NH /FI "IMAGENAME eq ${imageName}" /FO csv`, { encoding: 'utf8' }).trim();
    if (output.includes('No tasks are running')) return [];
    return output.split(/\r?\n/).map(line => {
      const parts = line.split(',');
      if (parts.length >= 2) {
        return parseInt(parts[1].replace(/"/g, ''), 10);
      }
      return null;
    }).filter(pid => pid !== null);
  } catch (e) {
    return [];
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

function postJson(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Length': 0
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  console.log('=== MEMORY STABILITY & PROCESS LEAK VERIFICATION ===');
  const harness = new E2ETestHarness();
  harness.setupSandbox();
  
  const port = 19999;
  console.log(`Spawning daemon on virtual drive: ${harness.virtualDrivePath}`);
  harness.startDaemon({ PORT: port.toString(), DEBOUNCE_DELAY: '500', START_SERVER: 'true' });
  await harness.waitForDaemonReady();
  
  const daemonPid = harness.daemonProcess.pid;
  console.log(`Daemon PID: ${daemonPid}`);
  
  const initialMem = getMemoryUsage(daemonPid);
  console.log(`Initial memory usage: ${initialMem} KB`);
  
  const iterations = 30;
  const memHistory = [initialMem];
  
  for (let i = 1; i <= iterations; i++) {
    const repoName = `stability_repo_${i}`;
    console.log(`\n--- Iteration ${i} / ${iterations} ---`);
    
    // 1. Add repository
    console.log(`Adding repository: ${repoName}`);
    harness.createMockRepo(repoName, true);
    
    // Force scan
    await postJson(`http://localhost:${port}/api/scan`);
    
    // Wait for daemon to detect repository
    let detected = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const status = await fetchJson(`http://localhost:${port}/api/status`);
      const watched = Object.keys(status.watchedRepositories);
      if (watched.some(p => p.endsWith(repoName))) {
        detected = true;
        break;
      }
      await delay(200);
    }
    if (!detected) {
      throw new Error(`Daemon failed to detect repo ${repoName}`);
    }
    console.log(`Daemon successfully detected and watched: ${repoName}`);
    
    // 2. Modify repository to trigger sync
    console.log(`Triggering file system modification in ${repoName}`);
    harness.createFile(repoName, `file_${i}.txt`, `stability test iteration ${i}`);
    
    // Wait for the sync to run and complete
    const remotePath = path.join(harness.remotesPath, `${repoName}.git`);
    let synced = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const commitMsg = harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']).stdout.trim();
        if (commitMsg.includes('Auto-sync:')) {
          synced = true;
          break;
        }
      } catch (e) {}
      await delay(200);
    }
    if (!synced) {
      throw new Error(`Sync failed or timed out for ${repoName}`);
    }
    console.log(`Sync completed successfully for ${repoName}`);
    
    // 3. Remove repository
    console.log(`Removing repository: ${repoName}`);
    harness.deleteRepo(repoName);
    
    // Force scan
    await postJson(`http://localhost:${port}/api/scan`);
    
    // Wait for daemon to detect removal and clean up watchers
    let cleaned = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const status = await fetchJson(`http://localhost:${port}/api/status`);
      const watched = Object.keys(status.watchedRepositories);
      if (!watched.some(p => p.endsWith(repoName))) {
        cleaned = true;
        break;
      }
      await delay(200);
    }
    if (!cleaned) {
      throw new Error(`Daemon failed to clean up watchers for ${repoName}`);
    }
    console.log(`Daemon successfully stopped watching and cleaned up: ${repoName}`);
    
    const currentMem = getMemoryUsage(daemonPid);
    memHistory.push(currentMem);
    console.log(`Memory usage: ${currentMem} KB (Diff: ${currentMem - initialMem} KB)`);
    
    // Check if git.exe or node.exe processes are left orphaned
    const runningGitPids = getRunningProcesses('git.exe');
    const runningNodePids = getRunningProcesses('node.exe');
    console.log(`Active git.exe PIDs: [${runningGitPids.join(', ')}]`);
    console.log(`Active node.exe PIDs: [${runningNodePids.join(', ')}]`);
  }
  
  console.log('\n--- Final Teardown ---');
  await harness.stopDaemon();
  harness.cleanSandbox();
  
  console.log('Memory usage history:', memHistory);
  const finalMem = memHistory[memHistory.length - 1];
  const maxMem = Math.max(...memHistory);
  const minMem = Math.min(...memHistory.slice(1));
  console.log(`Peak memory usage: ${maxMem} KB`);
  console.log(`Memory leak indicator (Final - Initial): ${finalMem - initialMem} KB`);
  
  if (finalMem - initialMem > 50 * 1024) {
    console.error('ERROR: Significant memory growth detected!');
    process.exitCode = 1;
  } else {
    console.log('SUCCESS: Memory usage remained stable.');
  }
}

run().catch(err => {
  console.error('Verification failed:', err);
  process.exitCode = 1;
});
