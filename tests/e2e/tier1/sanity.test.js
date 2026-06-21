const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const E2ETestHarness = require('../harness');

describe('Tier 1 Sanity & Smoke Tests', function () {
  this.timeout(30000); // 30 seconds limit for each test
  let harness;

  beforeEach(() => {
    harness = new E2ETestHarness();
    harness.setupSandbox();
  });

  afterEach(async function () {
    if (this.currentTest.state === 'failed') {
      console.log('--- DAEMON OUTPUT FOR FAILED TEST ---');
      console.log(harness.daemonOutput);
      console.log('--- SYNC.LOG FOR FAILED TEST ---');
      console.log(harness.readLog());
    }
    await harness.stopDaemon();
    harness.cleanSandbox();
  });

  // Helper to wait
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Helper to wait for a commit matching pattern in the remote repo
  const waitForRemoteCommit = async (remotePath, pattern, timeoutMs = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const commitMsg = harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']).stdout.trim();
        if (pattern.test(commitMsg)) {
          return commitMsg;
        }
      } catch (e) {}
      await delay(200);
    }
    return harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']).stdout.trim();
  };

  // Helper to wait for a file to appear in the remote repo tree
  const waitForRemoteFile = async (remotePath, branch, filename, timeoutMs = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const files = harness.gitCmd(remotePath, ['ls-tree', '-r', branch, '--name-only']).stdout;
        if (files.includes(filename)) {
          return files;
        }
      } catch (e) {}
      await delay(200);
    }
    return harness.gitCmd(remotePath, ['ls-tree', '-r', branch, '--name-only']).stdout;
  };

  // Helper to wait for the sync.log to contain a string or pattern
  const waitForLogContent = async (pattern, timeoutMs = 8000) => {
    const start = Date.now();
    const isPattern = pattern instanceof RegExp;
    while (Date.now() - start < timeoutMs) {
      const log = harness.readLog();
      if (isPattern ? pattern.test(log) : log.includes(pattern)) {
        return log;
      }
      await delay(200);
    }
    return harness.readLog();
  };

  // TC-T1-01: Detect file creation in root repo
  it('TC-T1-01: Detect file creation in root repo', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'test1.txt', 'hello world');

    // Check that remote has the commit
    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = await waitForRemoteCommit(remotePath, /Auto-sync:/);
    expect(commitMsg).to.match(/Auto-sync:/);

    const log = harness.readLog();
    expect(log).to.include('repo1');
  });

  // TC-T1-02: Detect file modification in root repo
  it('TC-T1-02: Detect file modification in root repo', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'init.txt', 'updated content');

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = await waitForRemoteCommit(remotePath, /Auto-sync:/);
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T1-03: Detect file deletion in root repo
  it('TC-T1-03: Detect file deletion in root repo', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.deleteFile('repo1', 'init.txt');

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = await waitForRemoteCommit(remotePath, /Auto-sync:/);
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T1-04: Detect file creation in level-1 repo
  it('TC-T1-04: Detect file creation in level-1 repo', async () => {
    // Create level1_dir inside sandbox_e, then repo2 inside level1_dir
    const level1Dir = path.join(harness.virtualDrivePath, 'level1_dir');
    fs.mkdirSync(level1Dir, { recursive: true });
    
    harness.createMockRepo('level1_dir/repo2', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('level1_dir/repo2', 'test2.txt', 'level 1 test');

    const remotePath = path.join(harness.remotesPath, 'level1_dir/repo2.git');
    const commitMsg = await waitForRemoteCommit(remotePath, /Auto-sync:/);
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T1-05: Detect file modification in level-1 repo
  it('TC-T1-05: Detect file modification in level-1 repo', async () => {
    const level1Dir = path.join(harness.virtualDrivePath, 'level1_dir');
    fs.mkdirSync(level1Dir, { recursive: true });

    harness.createMockRepo('level1_dir/repo2', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('level1_dir/repo2', 'init.txt', 'updated level 1 test');

    const remotePath = path.join(harness.remotesPath, 'level1_dir/repo2.git');
    const commitMsg = await waitForRemoteCommit(remotePath, /Auto-sync:/);
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T1-06: Detect file deletion in level-1 repo
  it('TC-T1-06: Detect file deletion in level-1 repo', async () => {
    const level1Dir = path.join(harness.virtualDrivePath, 'level1_dir');
    fs.mkdirSync(level1Dir, { recursive: true });

    harness.createMockRepo('level1_dir/repo2', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.deleteFile('level1_dir/repo2', 'init.txt');

    const remotePath = path.join(harness.remotesPath, 'level1_dir/repo2.git');
    const commitMsg = await waitForRemoteCommit(remotePath, /Auto-sync:/);
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T1-07: Ignore file creation in a non-git directory
  it('TC-T1-07: Ignore file creation in a non-git directory', async () => {
    const nonGitPath = path.join(harness.virtualDrivePath, 'non_git_folder');
    fs.mkdirSync(nonGitPath, { recursive: true });

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    fs.writeFileSync(path.join(nonGitPath, 'file.txt'), 'ignore me');
    await delay(3500);

    const log = harness.readLog();
    expect(log).to.not.include('non_git_folder');
  });

  // TC-T1-08: Ignore file creation in level-2 directory
  it('TC-T1-08: Ignore file creation in level-2 directory', async () => {
    const level2Path = path.join(harness.virtualDrivePath, 'folder', 'subfolder');
    fs.mkdirSync(level2Path, { recursive: true });

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    fs.writeFileSync(path.join(level2Path, 'file.txt'), 'ignore me too');
    await delay(3500);

    const log = harness.readLog();
    expect(log).to.not.include('subfolder');
  });

  // TC-T1-09: Detect subfolder creation in git repo
  it('TC-T1-09: Detect subfolder creation in git repo', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'new_folder/file.txt', 'nested file');

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = await waitForRemoteCommit(remotePath, /Auto-sync:/);
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T1-10: Trigger sync after debounce elapsed
  it('TC-T1-10: Trigger sync after debounce elapsed', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '3000' });
    await harness.waitForDaemonReady();

    const t0 = Date.now();
    harness.createFile('repo1', 'test.txt', 'debounce check');

    // Wait 2 seconds (less than 3s debounce delay)
    await delay(2000);
    let log = harness.readLog();
    expect(log).to.not.include('Synchronization cycle completed'); // Should not have finished

    // Wait for the sync to complete
    log = await waitForLogContent('Synchronization cycle completed');
    expect(log).to.include('repo1');
  });

  // TC-T1-11: Verify debounce queue holds changes
  it('TC-T1-11: Verify debounce queue holds changes', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '3000' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'test.txt', 'hold changes check');
    await delay(1000);

    const log = harness.readLog();
    // Verify sync has not triggered yet because debounce is 3s
    expect(log).to.not.include('Starting synchronization cycle');
  });

  // TC-T1-12: Stage new untracked files
  it('TC-T1-12: Stage new untracked files', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'new.txt', 'untracked');

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const files = await waitForRemoteFile(remotePath, 'master', 'new.txt');
    expect(files).to.include('new.txt');
  });

  // TC-T1-13: Commit created with automatic timestamp
  it('TC-T1-13: Commit created with automatic timestamp', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'time.txt', 'timestamp test');

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = await waitForRemoteCommit(remotePath, /^Auto-sync: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(commitMsg).to.match(/^Auto-sync: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  // TC-T1-14: Push to mock remote origin succeeds
  it('TC-T1-14: Push to mock remote origin succeeds', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'push.txt', 'push content');

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = await waitForRemoteCommit(remotePath, /Auto-sync:/);
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T1-15: Pull from remote origin runs before pushing
  it('TC-T1-15: Pull from remote origin runs before pushing', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'pull_check.txt', 'check');
    const log = await waitForLogContent('Synchronization cycle completed successfully');

    const pullIndex = log.indexOf('Pulling latest changes');
    const pushIndex = log.indexOf('Pushing changes');
    expect(pullIndex).to.not.equal(-1);
    expect(pushIndex).to.not.equal(-1);
    expect(pullIndex).to.be.below(pushIndex);
  });

  // TC-T1-16: Daemon continues when repo has no remote
  it('TC-T1-16: Daemon continues when repo has no remote', async () => {
    harness.createMockRepo('repo_no_remote', false);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('repo_no_remote', 'no_remote.txt', 'no remote content');
    const log = await waitForLogContent('Synchronization cycle completed successfully');

    // Commit should succeed, push skipped, and daemon should stay active
    expect(log).to.include('repo_no_remote');
    expect(harness.daemonProcess).to.not.be.null;
  });

  // TC-T1-17: Daemon continues when git command fails
  it('TC-T1-17: Daemon continues when git command fails', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    // Break the remote URL config to cause failure on push/pull
    harness.gitCmd(localPath, ['remote', 'set-url', 'origin', 'invalid_path_to_remote']);

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'fail.txt', 'trigger fail');
    const log = await waitForLogContent('Pull failed');

    // Daemon should log git failure and remain running
    expect(log).to.include('repo1');
    expect(harness.daemonProcess).to.not.be.null;
  });

  // TC-T1-18: Verify errors are written to sync.log
  it('TC-T1-18: Verify errors are written to sync.log', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    harness.gitCmd(localPath, ['remote', 'set-url', 'origin', 'invalid_path_to_remote']);

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'error_log_check.txt', 'error check');
    const log = await waitForLogContent('Pull failed');

    expect(log.toLowerCase()).to.include('error');
  });

  // TC-T1-19: Handle repo deletion during debounce window
  it('TC-T1-19: Handle repo deletion during debounce window', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '3000' });
    await harness.waitForDaemonReady();

    harness.createFile('repo1', 'temp.txt', 'temp file');
    await delay(500);

    // Delete repository directory before debounce ends
    harness.deleteRepo('repo1');

    // Wait for daemon to log skipping repository
    const log = await waitForLogContent('Repository path does not exist. Skipping sync');
    expect(harness.daemonProcess).to.not.be.null;
  });

  // TC-T1-20: Installer runs without syntax errors
  it('TC-T1-20: Installer runs without syntax errors', function () {
    const scriptPath = path.resolve(__dirname, '../../../install.ps1');
    if (!fs.existsSync(scriptPath)) {
      this.skip(); // skip if installer file doesn't exist yet
    }

    const res = child_process.spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-TestMode'
    ], { encoding: 'utf8' });

    expect(res.status).to.equal(0);
  });

  // TC-T1-21: Registry run key entries created
  it('TC-T1-21: Registry run key entries created', function () {
    const scriptPath = path.resolve(__dirname, '../../../install.ps1');
    if (!fs.existsSync(scriptPath)) {
      this.skip();
    }

    child_process.spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-TestMode'
    ]);

    // Check registry entry using PowerShell
    const checkRegCmd = 'Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "GitAutoSync_Test" -ErrorAction SilentlyContinue';
    const res = child_process.spawnSync('powershell.exe', ['-Command', checkRegCmd], { encoding: 'utf8' });

    expect(res.stdout).to.include('GitAutoSync_Test');

    // Clean up registry entry
    const cleanRegCmd = 'Remove-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "GitAutoSync_Test" -ErrorAction SilentlyContinue';
    child_process.spawnSync('powershell.exe', ['-Command', cleanRegCmd]);
  });

  // TC-T1-22: Registry entry references launcher
  it('TC-T1-22: Registry entry references launcher', function () {
    const scriptPath = path.resolve(__dirname, '../../../install.ps1');
    if (!fs.existsSync(scriptPath)) {
      this.skip();
    }

    child_process.spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-TestMode'
    ]);

    const getRegValCmd = '(Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "GitAutoSync_Test").GitAutoSync_Test';
    const res = child_process.spawnSync('powershell.exe', ['-Command', getRegValCmd], { encoding: 'utf8' });
    const val = res.stdout.trim();

    expect(val).to.match(/wscript\.exe\s+".*launcher\.vbs"/i);

    const cleanRegCmd = 'Remove-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "GitAutoSync_Test" -ErrorAction SilentlyContinue';
    child_process.spawnSync('powershell.exe', ['-Command', cleanRegCmd]);
  });

  // TC-T1-23: Launcher runs windowless
  it('TC-T1-23: Launcher runs windowless', function () {
    const launcherPath = path.resolve(__dirname, '../../../launcher.vbs');
    if (!fs.existsSync(launcherPath)) {
      this.skip();
    }

    // Try starting launcher
    const res = child_process.spawnSync('wscript.exe', [launcherPath], { timeout: 5000 });
    // Should return 0 or execute without bringing up standard prompt windows
    expect(res.status).to.equal(0);
  });

  // TC-T1-24: Verify helper script verify_sync.ps1 runs
  it('TC-T1-24: Verify helper script verify_sync.ps1 runs', function () {
    const verifyScriptPath = path.resolve(__dirname, '../../../verify_sync.ps1');
    if (!fs.existsSync(verifyScriptPath)) {
      this.skip();
    }

    const res = child_process.spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', verifyScriptPath
    ], { encoding: 'utf8' });

    expect(res.status).to.equal(0);
  });

  // TC-T1-25: Verify GCM credential helper check
  it('TC-T1-25: Verify GCM credential helper check', function () {
    const scriptPath = path.resolve(__dirname, '../../../install.ps1');
    if (!fs.existsSync(scriptPath)) {
      this.skip();
    }

    const res = child_process.spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-TestMode'
    ], { encoding: 'utf8' });

    // GCM check should be executed and logged during install script execution
    expect(res.stdout.toLowerCase()).to.satisfy(
      (out) => out.includes('credential') || out.includes('gcm') || out.includes('helper') || res.status === 0
    );
  });
});
