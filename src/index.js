const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { watchRepositories, stopWatching } = require('./repo-watcher');

// Base directory configurable via env, defaulting to 'E:\'
const BASE_DIR = process.env.TEST_E_DRIVE_PATH || 'E:\\';
const lockFilePath = path.join(BASE_DIR, '.sync.lock');

/**
 * Acquires lock on the base directory to prevent concurrent daemon execution.
 */
function acquireLock() {
  try {
    if (fs.existsSync(lockFilePath)) {
      const existingPid = parseInt(fs.readFileSync(lockFilePath, 'utf8').trim(), 10);
      if (existingPid) {
        try {
          process.kill(existingPid, 0);
          // Process is still running, abort startup
          logger.error(`Another daemon instance with PID ${existingPid} is already running. Exiting.`);
          process.exit(1);
        } catch (e) {
          if (e.code === 'ESRCH') {
            // Process is not running, lock is stale, we can remove it
            logger.warn(`Stale lock file found for PID ${existingPid}. Removing it.`);
            try { fs.unlinkSync(lockFilePath); } catch (err) {}
          } else {
            // Process is likely running but we do not have permission or another error occurred.
            // Exit immediately and do not delete the lock file.
            logger.error(`Another daemon instance with PID ${existingPid} is running (kill error: ${e.code || e.message}). Exiting.`);
            process.exit(1);
          }
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
if (process.env.NODE_ENV !== 'test' && !process.env.TEST_E_DRIVE_PATH) {
  const defaultPort = parseInt(process.env.PORT, 10) || 3000;
  startServer(defaultPort);
}

