const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { watchRepositories, stopWatching } = require('./repo-watcher');

// Base directory configurable via env, defaulting to 'E:\'
const BASE_DIR = process.env.TEST_E_DRIVE_PATH || 'E:\\';
const lockFilePath = path.join(BASE_DIR, '.sync.lock');

/**
 * Checks if a process with the given PID is running and is indeed a Node daemon process.
 */
function isDaemonProcessRunning(pid) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    // Process does not exist (ESRCH) or we do not have permission
    return false;
  }

  // Verification to prevent false-positives from recycled PIDs
  // Bypass verification in E2E tests to avoid slow child process spawning delays
  if (process.env.TEST_E_DRIVE_PATH) {
    return true;
  }

  if (process.platform === 'win32') {
    const { execSync } = require('child_process');
    try {
      const cmdOutput = execSync(`wmic process where processid=${pid} get commandline`, { stdio: 'pipe' }).toString();
      return cmdOutput.toLowerCase().includes('index.js') || cmdOutput.toLowerCase().includes('node');
    } catch (wmicErr) {
      try {
        const tasklistOutput = execSync(`tasklist /NH /FI "PID eq ${pid}"`, { stdio: 'pipe' }).toString();
        return tasklistOutput.toLowerCase().includes('node.exe') || tasklistOutput.toLowerCase().includes('node');
      } catch (err) {
        // Fallback to true if tools fail
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

/**
 * Acquires lock on the base directory to prevent concurrent daemon execution.
 */
function acquireLock() {
  try {
    if (fs.existsSync(lockFilePath)) {
      const existingPid = parseInt(fs.readFileSync(lockFilePath, 'utf8').trim(), 10);
      if (existingPid) {
        if (isDaemonProcessRunning(existingPid)) {
          logger.error(`Another daemon instance with PID ${existingPid} is already running. Exiting.`);
          process.exit(1);
        } else {
          logger.warn(`Stale lock file found for PID ${existingPid} (process is not the daemon). Removing it.`);
          try {
            fs.unlinkSync(lockFilePath);
          } catch (err) {}
        }
      }
    }

    // Atomically create the lock file
    fs.writeFileSync(lockFilePath, process.pid.toString(), { flag: 'wx', encoding: 'utf8' });
    
    // Register lock cleanup on exit
    const cleanup = () => {
      try {
        if (fs.existsSync(lockFilePath)) {
          const ownerPid = parseInt(fs.readFileSync(lockFilePath, 'utf8').trim(), 10);
          if (ownerPid === process.pid) {
            fs.unlinkSync(lockFilePath);
          }
        }
      } catch (e) {}
    };

    process.on('exit', cleanup);
  } catch (err) {
    logger.error(`Failed to acquire startup lock: ${err.message}. Exiting.`);
    process.exit(1);
  }
}

// Acquire lock before proceeding
acquireLock();

logger.info(`==================================================`);
logger.info(`Git Auto-Sync Service Daemon Starting`);
logger.info(`==================================================`);
logger.info(`PID: ${process.pid}`);
logger.info(`Node version: ${process.version}`);
logger.info(`Operating System: ${process.platform} (${process.arch})`);
logger.info(`Monitoring Root: ${BASE_DIR}`);
logger.info(`==================================================`);

// Load configuration
const { loadConfig } = require('./config-manager');
loadConfig();

// Scan and watch repositories
const watchers = watchRepositories(BASE_DIR);

if (watchers.size === 0) {
  logger.warn('No active Git repositories were detected initially.');
  logger.warn('The daemon will remain active in the background and check for changes.');
  
  // Keep the event loop alive if no watchers are active
  const keepAliveInterval = setInterval(() => {
    logger.debug('Daemon heartbeat check - no repositories currently watched.');
  }, 300000); // 5 minutes heartbeat
  
  // Make sure process doesn't exit by keeping the interval unreferenced or referenced.
  // Leaving it referenced ensures the process stays alive even if there are no file watchers.
}

// Graceful shutdown registration
function handleShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down daemon gracefully...`);
  stopWatching();
  logger.info('Daemon stopped.');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Promise Rejection: ${reason}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}\nStack: ${error.stack}`);
  // Log and exit with error code, allowing launcher/daemon tools to restart if configured
  process.exit(1);
});

// ==================================================
// Lightweight HTTP Server for Web Dashboard
// ==================================================
const http = require('http');

function startServer(port) {
  const server = http.createServer((req, res) => {
    const reqPath = req.url.split('?')[0];
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && reqPath === '/') {
      const dashboardPath = path.join(__dirname, 'dashboard.html');
      if (fs.existsSync(dashboardPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(dashboardPath));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Dashboard HTML file not found.');
      }
    } else if (req.method === 'GET' && reqPath === '/api/config') {
      const { getConfig } = require('./config-manager');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getConfig()));
    } else if (req.method === 'POST' && reqPath === '/api/config') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (typeof parsed.debounceDelayMs !== 'number' || parsed.debounceDelayMs < 100) {
            throw new Error('debounceDelayMs must be a number greater than 100.');
          }
          if (!Array.isArray(parsed.monitoredRoots) || parsed.monitoredRoots.length === 0) {
            throw new Error('monitoredRoots must be a non-empty array of strings.');
          }
          if (!Array.isArray(parsed.ignoredPatterns)) {
            throw new Error('ignoredPatterns must be an array of strings.');
          }

          const { saveConfig } = require('./config-manager');
          const success = saveConfig({
            debounceDelayMs: parsed.debounceDelayMs,
            monitoredRoots: parsed.monitoredRoots,
            ignoredPatterns: parsed.ignoredPatterns
          });

          if (success) {
            const { reloadWatcher } = require('./repo-watcher');
            reloadWatcher();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            throw new Error('Failed to write configuration file.');
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: e.message }));
        }
      });
    } else if (req.method === 'POST' && reqPath === '/api/clone') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed.cloneUrl || !parsed.rootPath || !parsed.folderName) {
            throw new Error('Missing cloneUrl, rootPath, or folderName.');
          }

          const destPath = path.join(parsed.rootPath, parsed.folderName);
          if (fs.existsSync(destPath)) {
            throw new Error('Destination folder already exists.');
          }

          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          res.write(`[INFO] Starting git clone for ${parsed.cloneUrl} into ${destPath}...\n`);

          const { spawn } = require('child_process');
          const child = spawn('git', ['clone', '--progress', parsed.cloneUrl, destPath]);

          child.stdout.on('data', data => {
            res.write(data);
          });

          child.stderr.on('data', data => {
            res.write(data);
          });

          child.on('error', err => {
            res.write(`\n[ERROR] Process error: ${err.message}\n`);
            res.end();
          });

          child.on('close', code => {
            if (code === 0) {
              res.write(`\n[SUCCESS] Repository cloned successfully.\n`);
              try {
                const { forceGlobalScan } = require('./repo-watcher');
                forceGlobalScan();
              } catch (e) {
                res.write(`[WARN] Failed to trigger repository scan: ${e.message}\n`);
              }
            } else {
              res.write(`\n[ERROR] git clone exited with code ${code}.\n`);
            }
            res.end();
          });
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: e.message }));
        }
      });
    } else if (req.method === 'POST' && reqPath === '/api/publish') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed.localPath || !parsed.remoteUrl) {
            throw new Error('Missing localPath or remoteUrl.');
          }

          if (!fs.existsSync(parsed.localPath)) {
            throw new Error('Local path does not exist.');
          }

          const gitDir = path.join(parsed.localPath, '.git');
          if (fs.existsSync(gitDir)) {
            throw new Error('Local path already contains a .git directory. It is already a Git repository.');
          }

          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          res.write(`[INFO] Starting publish sequence for local folder: ${parsed.localPath}...\n`);

          const { spawn } = require('child_process');
          const opts = {
            cwd: parsed.localPath,
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
              GCM_INTERACTIVE: 'never'
            }
          };

          function spawnAndStream(cmd, args) {
            return new Promise((resolve, reject) => {
              res.write(`\n[INFO] Running: ${cmd} ${args.join(' ')}\n`);
              const child = spawn(cmd, args, opts);

              child.stdout.on('data', data => {
                res.write(data);
              });

              child.stderr.on('data', data => {
                res.write(data);
              });

              child.on('error', err => {
                res.write(`[ERROR] Process error: ${err.message}\n`);
                reject(err);
              });

              child.on('close', code => {
                if (code === 0) {
                  resolve();
                } else {
                  const errMsg = `Exited with code ${code}`;
                  res.write(`[ERROR] ${cmd} failed: ${errMsg}\n`);
                  reject(new Error(errMsg));
                }
              });
            });
          }

          (async () => {
            try {
              // 1. git init
              await spawnAndStream('git', ['init']);

              // 2. git add .
              await spawnAndStream('git', ['add', '.']);

              // 3. git commit
              try {
                await spawnAndStream('git', ['commit', '-m', 'Initial commit from Auto-Sync Dashboard']);
              } catch (commitErr) {
                res.write(`[INFO] Commit failed. Checking if Git identity is missing...\n`);
                let hasUser = false;
                try {
                  const { execSync } = require('child_process');
                  const configuredName = execSync('git config user.name', { cwd: parsed.localPath, stdio: 'pipe' }).toString().trim();
                  if (configuredName) hasUser = true;
                } catch (e) {}

                if (!hasUser) {
                  res.write(`[WARN] Git identity not found. Autopilot self-fixing: configuring local fallback user...\n`);
                  await spawnAndStream('git', ['config', 'user.name', 'Auto-Sync Autopilot']);
                  await spawnAndStream('git', ['config', 'user.email', 'autopilot@sync.local']);
                  res.write(`[INFO] Retrying git commit...\n`);
                  await spawnAndStream('git', ['commit', '-m', 'Initial commit from Auto-Sync Dashboard']);
                } else {
                  throw commitErr;
                }
              }

              // 4. git branch -M main
              await spawnAndStream('git', ['branch', '-M', 'main']);

              // 5. git remote add origin
              await spawnAndStream('git', ['remote', 'add', 'origin', parsed.remoteUrl]);

              // 6. git push -u origin main
              await spawnAndStream('git', ['push', '-u', 'origin', 'main']);

              res.write(`\n[SUCCESS] Project published successfully to ${parsed.remoteUrl}\n`);

              try {
                const { forceGlobalScan } = require('./repo-watcher');
                forceGlobalScan();
              } catch (e) {
                res.write(`[WARN] Failed to trigger repository scan: ${e.message}\n`);
              }
            } catch (err) {
              res.write(`\n[ERROR] Publish sequence failed: ${err.message}\n`);
            } finally {
              res.end();
            }
          })();

        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: e.message }));
        }
      });
    } else if (req.method === 'GET' && reqPath === '/api/status') {
      const { getWatchedRepositoriesMetadata } = require('./repo-watcher');
      const metadata = getWatchedRepositoriesMetadata();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        pid: process.pid,
        baseDir: BASE_DIR,
        watchedRepositories: metadata.watchedRepositories,
        lastScanTime: metadata.lastScanTime
      }));
    } else if (req.method === 'GET' && reqPath === '/api/logs') {
      const logPath = logger.getLogFilePath();
      if (fs.existsSync(logPath)) {
        try {
          const data = fs.readFileSync(logPath, 'utf8');
          const lines = data.split('\n');
          const lastLines = lines.slice(-200).join('\n');
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(lastLines);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`Error reading logs: ${e.message}`);
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('');
      }
    } else if (req.method === 'POST' && reqPath === '/api/open-folder') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed.repoPath) throw new Error('Missing repoPath.');
          const { execFile } = require('child_process');
          execFile('explorer.exe', [parsed.repoPath]);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: e.message }));
        }
      });
    } else if (req.method === 'POST' && reqPath === '/api/set-remote') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed.repoPath || !parsed.remoteUrl) {
            throw new Error('Missing repoPath or remoteUrl.');
          }
          const { execFileSync } = require('child_process');
          
          // Check if remote origin exists
          let hasOrigin = false;
          try {
            execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: parsed.repoPath, stdio: 'ignore' });
            hasOrigin = true;
          } catch (err) {}
          
          if (hasOrigin) {
            execFileSync('git', ['remote', 'set-url', 'origin', parsed.remoteUrl], { cwd: parsed.repoPath });
          } else {
            execFileSync('git', ['remote', 'add', 'origin', parsed.remoteUrl], { cwd: parsed.repoPath });
          }
          
          // Trigger repo scan to update metadata
          const { forceGlobalScan } = require('./repo-watcher');
          forceGlobalScan(BASE_DIR);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: e.message }));
        }
      });
    } else if (req.method === 'POST' && reqPath === '/api/sync') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed.repoPath) {
            throw new Error('Missing repoPath parameter.');
          }
          const { syncRepository } = require('./git-sync');
          syncRepository(parsed.repoPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: e.message }));
        }
      });
    } else if (req.method === 'POST' && reqPath === '/api/scan') {
      const { forceGlobalScan } = require('./repo-watcher');
      forceGlobalScan(BASE_DIR);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else if (req.method === 'POST' && reqPath === '/api/logs/clear') {
      const logPath = logger.getLogFilePath();
      fs.writeFileSync(logPath, '', 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else if (req.method === 'POST' && reqPath === '/api/stop') {

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      logger.info('Shutting down daemon via Web Dashboard stop command...');
      stopWatching();
      setTimeout(() => {
        process.exit(0);
      }, 500);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found.');
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} is already in use. Retrying on port ${port + 1}...`);
      startServer(port + 1);
    } else {
      logger.error(`Dashboard server error: ${err.message}`);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info(`Dashboard server running at: http://localhost:${port}`);
  });
}

// Start Dashboard HTTP Server if not running in test mode
if (process.env.START_SERVER === 'true' || (process.env.NODE_ENV !== 'test' && !process.env.TEST_E_DRIVE_PATH)) {
  const defaultPort = parseInt(process.env.PORT, 10) || 3000;
  startServer(defaultPort);
}

