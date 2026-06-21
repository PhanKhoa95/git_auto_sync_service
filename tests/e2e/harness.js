const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

class E2ETestHarness {
  constructor() {
    this.sandboxRoot = null;
    this.virtualDrivePath = null;
    this.remotesPath = null;
    this.logPath = null;
    this.daemonProcess = null;
    this.daemonOutput = '';
    this.allDaemonProcesses = [];
  }

  /**
   * Creates a unique temp directory structure to act as the sandbox environment.
   */
  setupSandbox() {
    const tempDir = os.tmpdir();
    const prefix = 'git-auto-sync-test-' + Math.random().toString(36).substring(2, 10);
    this.sandboxRoot = path.join(tempDir, prefix);

    fs.mkdirSync(this.sandboxRoot, { recursive: true });

    // virtualDrivePath represents "E:\" virtualized
    this.virtualDrivePath = path.join(this.sandboxRoot, 'sandbox_e');
    fs.mkdirSync(this.virtualDrivePath, { recursive: true });

    // remotesPath represents the folder for bare git repositories
    this.remotesPath = path.join(this.sandboxRoot, 'temp_remotes');
    fs.mkdirSync(this.remotesPath, { recursive: true });

    // logPath points to the sync.log inside the virtual drive
    const logDir = path.join(this.virtualDrivePath, 'git_auto_sync_service');
    fs.mkdirSync(logDir, { recursive: true });
    this.logPath = path.join(logDir, 'sync.log');
    fs.writeFileSync(this.logPath, '');

    // Set default test environment variables for child processes
    process.env.TEST_E_DRIVE_PATH = this.virtualDrivePath;
    process.env.SYNC_LOG_PATH = this.logPath;
    process.env.GIT_TERMINAL_PROMPT = '0';
    process.env.GCM_INTERACTIVE = 'never';
  }

  /**
   * Synchronously runs a Git command in a specified directory.
   */
  gitCmd(cwd, args) {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
    const res = child_process.spawnSync('git', args, {
      cwd,
      env,
      encoding: 'utf8'
    });
    if (res.error) {
      throw res.error;
    }
    return res;
  }

  /**
   * Initializes a Git repo inside the virtual drive.
   * If hasRemote is true, initializes a bare repo, sets it as remote origin,
   * and makes an initial commit.
   */
  createMockRepo(name, hasRemote = true) {
    if (!this.virtualDrivePath || !this.remotesPath) {
      throw new Error('Sandbox not set up. Call setupSandbox() first.');
    }

    const localRepoPath = path.join(this.virtualDrivePath, name);
    fs.mkdirSync(localRepoPath, { recursive: true });

    // Initialize local repo
    this.gitCmd(localRepoPath, ['init']);
    this.gitCmd(localRepoPath, ['checkout', '-b', 'master']);
    
    // Configure local dummy user for testing
    this.gitCmd(localRepoPath, ['config', 'user.name', 'E2ETester']);
    this.gitCmd(localRepoPath, ['config', 'user.email', 'tester@e2e.local']);

    if (hasRemote) {
      const bareRepoPath = path.join(this.remotesPath, name + '.git');
      fs.mkdirSync(bareRepoPath, { recursive: true });

      // Initialize bare remote repo
      this.gitCmd(bareRepoPath, ['init', '--bare']);

      // Setup initial commit in local repo
      const initFile = path.join(localRepoPath, 'init.txt');
      fs.writeFileSync(initFile, 'Initial commit file');

      this.gitCmd(localRepoPath, ['add', 'init.txt']);
      this.gitCmd(localRepoPath, ['commit', '-m', 'Initial commit']);

      // Link remote
      this.gitCmd(localRepoPath, ['remote', 'add', 'origin', bareRepoPath]);
      this.gitCmd(localRepoPath, ['push', '-u', 'origin', 'master']);
    }

    return localRepoPath;
  }

  /**
   * Spawns the Node.js daemon as a child process.
   */
  startDaemon(envOverrides = {}) {
    if (this.daemonProcess) {
      throw new Error('Daemon is already running.');
    }

    const daemonScript = path.resolve(__dirname, '../../src/index.js');
    const env = {
      ...process.env,
      TEST_E_DRIVE_PATH: this.virtualDrivePath,
      SYNC_LOG_PATH: this.logPath,
      DEBOUNCE_DELAY: '1000', // default to 1 second for fast testing
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      ...envOverrides
    };

    this.daemonEnv = env;
    this.daemonOutput = '';
    this.daemonProcess = child_process.spawn('node', [daemonScript], {
      env,
      cwd: this.virtualDrivePath
    });
    this.allDaemonProcesses.push(this.daemonProcess);

    this.daemonProcess.stdout.on('data', (data) => {
      this.daemonOutput += data.toString();
    });

    this.daemonProcess.stderr.on('data', (data) => {
      this.daemonOutput += data.toString();
    });

    this.daemonProcess.on('error', (err) => {
      this.daemonOutput += `[SPAWN ERROR] ${err.message}\n`;
    });

    this.daemonProcess.on('exit', (code, signal) => {
      this.daemonOutput += `[PROCESS EXIT] code: ${code}, signal: ${signal}\n`;
    });

    // Wait 300ms to allow Windows to bind fs.watch before the test continues
    const start = Date.now();
    while (Date.now() - start < 300) {}
  }

  /**
   * Polls the daemon output and logs to wait until it is fully initialized and watching.
   */
  async waitForDaemonReady(timeoutMs = 20000) {
    const start = Date.now();
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    while (Date.now() - start < timeoutMs) {
      const log = this.readLog();
      const hasWatcher = this.daemonOutput.includes('Setting up recursive file watcher') || log.includes('Setting up recursive file watcher');
      const hasNoRepos = this.daemonOutput.includes('No active Git repositories were detected') || log.includes('No active Git repositories were detected');
      const hasDashboard = this.daemonOutput.includes('Dashboard server running');
      if (hasWatcher || hasNoRepos || hasDashboard) {
        // Wait an extra 200ms to allow OS watcher binding to fully settle
        await delay(200);
        return;
      }
      await delay(100);
    }
    throw new Error("Daemon did not become ready within timeout. Output: " + this.daemonOutput);
  }

  /**
   * Kills the daemon process cleanly.
   */
  async stopDaemon() {
    if (this.allDaemonProcesses.length === 0 && this.daemonProcess) {
      this.allDaemonProcesses.push(this.daemonProcess);
    }

    const stopPromises = this.allDaemonProcesses.map(async (proc) => {
      if (!proc) return;
      const pid = proc.pid;
      try {
        child_process.execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      } catch (e) {
        try {
          proc.kill('SIGKILL');
        } catch (err) {}
      }
      await new Promise((resolve) => {
        proc.on('close', resolve);
        setTimeout(resolve, 3000);
      });
    });

    await Promise.all(stopPromises);
    this.allDaemonProcesses = [];
    this.daemonProcess = null;

    // Run taskkill /F /IM git.exe to kill any leftover git processes locking sandbox folders on Windows
    try {
      child_process.execSync('taskkill /F /IM git.exe', { stdio: 'ignore' });
    } catch (e) {}

    // Wait a brief moment (500ms) before returning, allowing Windows to release file handles.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  /**
   * Reads the contents of the log file sync.log.
   */
  readLog() {
    if (this.logPath && fs.existsSync(this.logPath)) {
      return fs.readFileSync(this.logPath, 'utf8');
    }
    return '';
  }

  /**
   * Clears the log file contents.
   */
  clearLog() {
    if (this.logPath && fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, '');
    }
  }

  /**
   * Helper to write/modify files in the sandbox repositories.
   */
  createFile(repoName, relativeFilePath, content = 'content') {
    const fullPath = path.join(this.virtualDrivePath, repoName, relativeFilePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  /**
   * Helper to delete a file in a sandbox repository.
   */
  deleteFile(repoName, relativeFilePath) {
    const fullPath = path.join(this.virtualDrivePath, repoName, relativeFilePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  /**
   * Helper to rename a file in a sandbox repository.
   */
  renameFile(repoName, oldRelativePath, newRelativePath) {
    const oldPath = path.join(this.virtualDrivePath, repoName, oldRelativePath);
    const newPath = path.join(this.virtualDrivePath, repoName, newRelativePath);
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.renameSync(oldPath, newPath);
  }

  /**
   * Helper to delete a repository directory in the sandbox.
   */
  deleteRepo(repoName) {
    const repoPath = path.join(this.virtualDrivePath, repoName);
    robustRemoveDir(repoPath);
  }

  /**
   * Deletes all temporary folders and files in the sandbox.
   */
  cleanSandbox() {
    if (!this.sandboxRoot) return;

    robustRemoveDir(this.sandboxRoot);
    this.sandboxRoot = null;
    this.virtualDrivePath = null;
    this.remotesPath = null;
    this.logPath = null;
  }
}

/**
 * Robust directory remover with EBUSY/EPERM retries on Windows.
 */
function robustRemoveDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  let children = [];
  try {
    children = fs.readdirSync(dirPath);
  } catch (err) {
    // ignore read errors, try to rmdir anyway
  }

  children.forEach((file) => {
    const curPath = path.join(dirPath, file);
    let isDir = false;
    let isSymLink = false;
    try {
      const stats = fs.lstatSync(curPath);
      isDir = stats.isDirectory();
      isSymLink = stats.isSymbolicLink();
    } catch (e) {
      return;
    }

    if (isDir && !isSymLink) {
      robustRemoveDir(curPath);
    } else {
      let attempts = 0;
      while (true) {
        try {
          try {
            fs.chmodSync(curPath, 0o666); // remove read-only attribute
          } catch (e) {}
          try {
            fs.unlinkSync(curPath);
          } catch (unlinkErr) {
            // handle fs.rmdirSync fallback if unlink fails on directory junctions/symlinks
            fs.rmdirSync(curPath);
          }
          break;
        } catch (err) {
          attempts++;
          if (attempts >= 30) {
            throw err;
          }
          // Sleep 200ms
          try {
            const sab = new SharedArrayBuffer(1024);
            const int32 = new Int32Array(sab);
            Atomics.wait(int32, 0, 0, 200);
          } catch (e) {
            const start = Date.now();
            while (Date.now() - start < 200) {}
          }
        }
      }
    }
  });

  let attempts = 0;
  while (true) {
    try {
      fs.rmdirSync(dirPath);
      break;
    } catch (err) {
      attempts++;
      if (attempts >= 30) {
        throw err;
      }
      // Sleep 200ms
      try {
        const sab = new SharedArrayBuffer(1024);
        const int32 = new Int32Array(sab);
        Atomics.wait(int32, 0, 0, 200);
      } catch (e) {
        const start = Date.now();
        while (Date.now() - start < 200) {}
      }
    }
  }
}

module.exports = E2ETestHarness;
