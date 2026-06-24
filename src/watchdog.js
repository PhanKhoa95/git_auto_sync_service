const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const indexJsPath = path.join(__dirname, 'index.js');
const BASE_DIR = process.env.TEST_E_DRIVE_PATH || path.parse(__dirname).root;
const lockFilePath = path.join(BASE_DIR, '.sync.lock');

// Resolve log file path uniform with repo-watcher.js
const logFilePath = path.resolve(process.env.TEST_LOG_FILE || process.env.SYNC_LOG_PATH || path.join(__dirname, '..', 'sync.log'));

function log(msg) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const formattedMsg = `[${timestamp}] [WATCHDOG] ${msg}\n`;
  try {
    const parentDir = path.dirname(logFilePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.appendFileSync(logFilePath, formattedMsg, 'utf8');
  } catch (e) {
    console.error(formattedMsg);
  }
}

/**
 * Verification to check if a process with the given PID is actually a Node daemon.
 */
function isDaemonProcessRunning(pid) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code === 'EPERM') {
      return true;
    }
    return false;
  }

  // Bypass verification in E2E tests to avoid slow child process spawning delays
  if (process.env.TEST_E_DRIVE_PATH) {
    return true;
  }

  if (process.platform === 'win32') {
    const { execSync } = require('child_process');
    try {
      // 1. Try tasklist first (standard on all Windows, not deprecated)
      const tasklistOutput = execSync(`tasklist /NH /FI "PID eq ${pid}"`, { stdio: 'pipe' }).toString();
      const lowerOutput = tasklistOutput.toLowerCase();
      if (lowerOutput.includes('node.exe') || lowerOutput.includes('node')) {
        return true;
      }
      return false;
    } catch (tasklistErr) {
      try {
        // 2. Fallback to wmic if tasklist fails
        const cmdOutput = execSync(`wmic process where processid=${pid} get commandline`, { stdio: 'pipe' }).toString();
        return cmdOutput.toLowerCase().includes('index.js') || cmdOutput.toLowerCase().includes('node');
      } catch (wmicErr) {
        return true;
      }
    }
  } else {
    const { execSync } = require('child_process');
    try {
      const psOutput = execSync(`ps -p ${pid} -o command=`, { stdio: 'pipe' }).toString();
      return psOutput.toLowerCase().includes('node') || psOutput.toLowerCase().includes('index.js');
    } catch (err) {
      return true;
    }
  }
}

function isDaemonAlreadyRunning() {
  if (!fs.existsSync(lockFilePath)) return false;
  try {
    const pid = parseInt(fs.readFileSync(lockFilePath, 'utf8').trim(), 10);
    if (!pid) return false;
    return isDaemonProcessRunning(pid);
  } catch (err) {
    return false;
  }
}

if (isDaemonAlreadyRunning()) {
  log('Another daemon instance is already active. Watchdog exiting.');
  process.exit(0);
}

let currentChild = null;
let consecutiveCrashes = 0;
let lastStart = 0;

function startDaemon() {
  log('Starting daemon process...');
  lastStart = Date.now();
  
  // Inherit standard environment, but ensure server start is active
  const childEnv = {
    ...process.env,
    START_SERVER: 'true'
  };

  const child = spawn(process.execPath, [indexJsPath], {
    cwd: path.dirname(indexJsPath),
    env: childEnv,
    stdio: 'ignore' // run silent/detached
  });
  currentChild = child;

  child.on('exit', (code, signal) => {
    currentChild = null;
    const elapsed = Date.now() - lastStart;
    log(`Daemon exited with code ${code} (signal: ${signal}). Run time: ${Math.round(elapsed / 1000)}s.`);

    // If code is 0, it means it exited gracefully (e.g. stop command from dashboard).
    // In this case, we stop restarting.
    if (code === 0) {
      log('Daemon exited cleanly. Watchdog shutting down.');
      process.exit(0);
    }

    // Check if it's a quick crash
    if (elapsed < 15000) {
      consecutiveCrashes++;
    } else {
      consecutiveCrashes = 0;
    }

    if (consecutiveCrashes >= 5) {
      log('Daemon crashed 5 times consecutively in less than 15 seconds. Watchdog stopping.');
      process.exit(1);
    }

    // Cooldown delay before restart
    const delay = elapsed < 15000 ? 15000 : 5000;
    log(`Scheduling restart in ${delay / 1000} seconds...`);
    setTimeout(startDaemon, delay);
  });
}

function handleShutdown(signal) {
  log(`Watchdog received ${signal}. Shutting down gracefully...`);
  if (currentChild && currentChild.exitCode === null && currentChild.signalCode === null) {
    log(`Terminating child daemon (PID: ${currentChild.pid})...`);
    try {
      currentChild.kill('SIGTERM');
    } catch (err) {}
  }
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Start the watchdog
log('Watchdog service active.');
startDaemon();
