const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const E2ETestHarness = require('../harness');

describe('Tier 2 Detailed Functional Tests', function () {
  this.timeout(35000);
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

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // TC-T2-01: Ignore changes in .git directory
  it('TC-T2-01: Ignore changes in .git directory', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.clearLog();
    // Modify config in .git
    const gitConfigPath = path.join(harness.virtualDrivePath, 'repo1', '.git', 'config');
    fs.appendFileSync(gitConfigPath, '\n# test comment\n');
    await delay(3500);

    const log = harness.readLog();
    expect(log).to.not.include('Sync complete');
  });

  // TC-T2-02: Detect changes inside nested directories
  it('TC-T2-02: Detect changes inside nested directories', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.createFile('repo1', 'sub1/sub2/deep.txt', 'deep file');
    await delay(3500);

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const files = harness.gitCmd(remotePath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    expect(files).to.include('sub1/sub2/deep.txt');
  });

  // TC-T2-03: Ignore files matched by .gitignore
  it('TC-T2-03: Ignore files matched by .gitignore', async () => {
    harness.createMockRepo('repo1', true);
    // Write .gitignore
    harness.createFile('repo1', '.gitignore', 'log/\n');
    await delay(1000); // Wait for gitignore to sync

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.createFile('repo1', 'log/debug.log', 'ignore me');
    await delay(3500);

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const files = harness.gitCmd(remotePath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    expect(files).to.not.include('log/debug.log');
  });

  // TC-T2-04: Watcher continues when a repo becomes unreadable
  it('TC-T2-04: Watcher continues when a repo becomes unreadable', async () => {
    const repo1 = harness.createMockRepo('repo1', true);
    const repo2 = harness.createMockRepo('repo2', true);

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    // Make repo2 unreadable on Windows using icacls (S-1-1-0 is Everyone SID)
    try {
      child_process.execSync(`icacls "${repo2}" /deny *S-1-1-0:(OI)(CI)(R)`, { stdio: 'ignore' });
    } catch (e) {
      // fallback if icacls fails (not on standard Windows or permission error)
    }

    harness.createFile('repo1', 'file.txt', 'repo1 still works');
    await delay(3500);

    // Restore permissions so cleanup can delete it
    try {
      child_process.execSync(`icacls "${repo2}" /remove:d *S-1-1-0`, { stdio: 'ignore' });
    } catch (e) {}

    const remotePath1 = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = harness.gitCmd(remotePath1, ['log', '-1', '--pretty=%B']).stdout.trim();
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T2-05: Detect multiple files created simultaneously
  it('TC-T2-05: Detect multiple files created simultaneously', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '1000' });
    await delay(500);

    for (let i = 1; i <= 5; i++) {
      harness.createFile('repo1', `file_${i}.txt`, `content ${i}`);
    }
    await delay(4500);

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']).stdout.trim();
    expect(commitMsg).to.match(/Auto-sync:/);

    const files = harness.gitCmd(remotePath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    for (let i = 1; i <= 5; i++) {
      expect(files).to.include(`file_${i}.txt`);
    }
  });

  // TC-T2-06: Detect file rename
  it('TC-T2-06: Detect file rename', async () => {
    harness.createMockRepo('repo1', true);
    harness.createFile('repo1', 'old.txt', 'rename test');
    await delay(1000); // Wait for file to be pushed first

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.renameFile('repo1', 'old.txt', 'new.txt');
    await delay(3500);

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const files = harness.gitCmd(remotePath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    expect(files).to.include('new.txt');
    expect(files).to.not.include('old.txt');
  });

  // TC-T2-07: Verify debounce reset on successive modifications
  it('TC-T2-07: Verify debounce reset on successive modifications', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '2000' });
    await delay(500);

    harness.createFile('repo1', 'debounce.txt', 'initial');
    await delay(1000); // before 2s elapsed

    harness.createFile('repo1', 'debounce.txt', 'second');
    await delay(1000); // before 2s elapsed from second write

    harness.createFile('repo1', 'debounce.txt', 'third');
    
    // Check it did not sync yet (total time since first is 2s, but 0s since third)
    let log = harness.readLog();
    expect(log).to.not.include('Sync complete');

    await delay(4500); // wait for 2.5s (should trigger)
    log = harness.readLog();
    expect(log).to.include('repo1');
  });

  // TC-T2-08: Verify independent debounce for multiple repos
  it('TC-T2-08: Verify independent debounce for multiple repos', async () => {
    harness.createMockRepo('repo1', true);
    harness.createMockRepo('repo2', true);

    harness.startDaemon({ DEBOUNCE_DELAY: '2000' });
    // Wait for startup sync to fully complete (daemon spawn + debounce time + pull/push time)
    await delay(3500);
    harness.clearLog();

    harness.createFile('repo1', 'file.txt', 'repo1 change');
    await delay(1000);

    harness.createFile('repo2', 'file.txt', 'repo2 change');
    await delay(1500); // repo1 has been 2.5s (triggered), repo2 has been 1.5s (not triggered)

    const log = harness.readLog();
    expect(log).to.include('[repo1] Starting synchronization cycle');
    expect(log).to.not.include('[repo2] Starting synchronization cycle');

    await delay(1500); // repo2 has now been 3.0s (triggered)
    const finalLog = harness.readLog();
    expect(finalLog).to.include('[repo2] Starting synchronization cycle');
  });

  // TC-T2-09: Verify multiple rapid changes trigger single sync
  it('TC-T2-09: Verify multiple rapid changes trigger single sync', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '2000' });
    // Wait for the startup sync to complete and record starting commit count
    await delay(3500);
    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const startCommits = parseInt(
      harness.gitCmd(remotePath, ['rev-list', '--count', 'master']).stdout.trim()
    );

    // Rapid writes
    for (let i = 0; i < 20; i++) {
      harness.createFile('repo1', 'rapid.txt', `write ${i}`);
      await delay(50);
    }
    await delay(4500); // wait for debounce

    const endCommits = parseInt(
      harness.gitCmd(remotePath, ['rev-list', '--count', 'master']).stdout.trim()
    );
    // There should be exactly 1 new commit from the rapid writes
    expect(endCommits).to.equal(startCommits + 1);
  });

  // TC-T2-10: Verify debounce window is configurable
  it('TC-T2-10: Verify debounce window is configurable', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '3000' }); // configured to 3.0s
    // Wait for startup sync to fully complete (daemon spawn + debounce time + pull/push time)
    await delay(4500);
    harness.clearLog();

    harness.createFile('repo1', 'config_test.txt', 'data');
    // Wait 2 seconds (less than 3.0s debounce delay)
    await delay(2000);
    expect(harness.readLog()).to.not.include('[repo1] Starting synchronization cycle');

    // Wait another 2 seconds (total 4s, which is > 3.0s)
    await delay(2000);
    expect(harness.readLog()).to.include('[repo1] Starting synchronization cycle');
  });

  // TC-T2-11: Verify commit message format
  it('TC-T2-11: Verify commit message format', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.createFile('repo1', 'format.txt', 'check msg');
    await delay(3500);

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']).stdout.trim();
    expect(commitMsg).to.match(/^Auto-sync: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  // TC-T2-12: Verify push works on non-main branches
  it('TC-T2-12: Verify push works on non-main branches', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    // Create and checkout branch
    harness.gitCmd(localPath, ['checkout', '-b', 'feature-branch']);
    harness.gitCmd(localPath, ['push', '-u', 'origin', 'feature-branch']);

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.createFile('repo1', 'branch.txt', 'branch content');
    await delay(3500);

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const files = harness.gitCmd(remotePath, ['ls-tree', '-r', 'feature-branch', '--name-only']).stdout;
    expect(files).to.include('branch.txt');
  });

  // TC-T2-13: Verify pull performs merge
  it('TC-T2-13: Verify pull performs merge', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    const bareRepoPath = path.join(harness.remotesPath, 'repo1.git');

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    // Commit a file directly to the remote repository from a peer repo
    const peerRepoPath = path.join(harness.sandboxRoot, 'peer_repo');
    harness.gitCmd(harness.sandboxRoot, ['clone', bareRepoPath, 'peer_repo']);
    
    // Configure peer identity
    harness.gitCmd(peerRepoPath, ['config', 'user.name', 'PeerTester']);
    harness.gitCmd(peerRepoPath, ['config', 'user.email', 'peer@tester.local']);
    
    fs.writeFileSync(path.join(peerRepoPath, 'remote.txt'), 'from remote');
    harness.gitCmd(peerRepoPath, ['add', 'remote.txt']);
    harness.gitCmd(peerRepoPath, ['commit', '-m', 'Commit from remote']);
    harness.gitCmd(peerRepoPath, ['push', 'origin', 'master']);

    // Now write a local modification
    harness.createFile('repo1', 'local.txt', 'from local');
    await delay(4500); // wait for sync

    // Verify local repository pulled and merged
    const localFiles = fs.readdirSync(localPath);
    expect(localFiles).to.include('remote.txt');
    expect(localFiles).to.include('local.txt');
  });

  // TC-T2-14: Verify git terminal prompt env vars
  it('TC-T2-14: Verify git terminal prompt env vars', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.createFile('repo1', 'env.txt', 'env values');
    await delay(3500);

    // The harness starts process with env settings, verifying them in startDaemon
    expect(harness.daemonEnv.GIT_TERMINAL_PROMPT).to.equal('0');
    expect(harness.daemonEnv.GCM_INTERACTIVE).to.equal('never');
  });

  // TC-T2-15: Verify push succeeds when credentials cached
  it('TC-T2-15: Verify push succeeds when credentials cached', async () => {
    // Tests push on a local remote, which succeeds because it uses filesystem protocols without prompt
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.createFile('repo1', 'cached.txt', 'credentials cached');
    await delay(3500);

    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const commitMsg = harness.gitCmd(remotePath, ['log', '-1', '--pretty=%B']).stdout.trim();
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T2-16: Handle merge conflicts gracefully during pull
  it('TC-T2-16: Handle merge conflicts gracefully during pull', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    const bareRepoPath = path.join(harness.remotesPath, 'repo1.git');

    // Create conflict file in remote repo
    const peerRepoPath = path.join(harness.sandboxRoot, 'peer_repo');
    harness.gitCmd(harness.sandboxRoot, ['clone', bareRepoPath, 'peer_repo']);
    harness.gitCmd(peerRepoPath, ['config', 'user.name', 'PeerTester']);
    harness.gitCmd(peerRepoPath, ['config', 'user.email', 'peer@tester.local']);

    // Setup initial conflict file
    harness.createFile('repo1', 'conflict.txt', 'initial line');
    await delay(1000); // wait for push

    // Modify conflict.txt in peer and push
    fs.writeFileSync(path.join(peerRepoPath, 'conflict.txt'), 'remote edit line');
    harness.gitCmd(peerRepoPath, ['add', 'conflict.txt']);
    harness.gitCmd(peerRepoPath, ['commit', '-m', 'conflict edit']);
    harness.gitCmd(peerRepoPath, ['push', 'origin', 'master']);

    // Now start the daemon
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    // Modify local conflict.txt with conflicting content
    fs.writeFileSync(path.join(localPath, 'conflict.txt'), 'local edit line');
    await delay(4500); // Wait for sync pull attempt

    const log = harness.readLog();
    // Verify pull failed/stopped due to conflict and was logged
    expect(log.toLowerCase()).to.satisfy(
      (out) => out.includes('conflict') || out.includes('fail') || out.includes('error')
    );
    expect(harness.daemonProcess).to.not.be.null; // Daemon stays alive
  });

  // TC-T2-17: Handle .git/index.lock presence
  it('TC-T2-17: Handle .git/index.lock presence', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    
    // Create dummy index.lock
    const lockPath = path.join(localPath, '.git', 'index.lock');
    fs.writeFileSync(lockPath, 'locked');

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.createFile('repo1', 'lock_check.txt', 'check');
    await delay(3500);

    const log = harness.readLog();
    // Daemon should log error about index.lock or command failure and continue
    expect(log.toLowerCase()).to.satisfy(
      (out) => out.includes('lock') || out.includes('fail') || out.includes('error')
    );
    expect(harness.daemonProcess).to.not.be.null;

    // clean lock so cleanSandbox works
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  });

  // TC-T2-18: Handle network timeout during push/pull
  it('TC-T2-18: Handle network timeout during push/pull', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    // Point remote to a non-existent SSH/HTTPS path that will fail/timeout
    harness.gitCmd(localPath, ['remote', 'set-url', 'origin', 'ssh://10.255.255.1/repo.git']);

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.createFile('repo1', 'timeout_check.txt', 'timeout content');
    await delay(4000);

    const log = harness.readLog();
    expect(log.toLowerCase()).to.satisfy(
      (out) => out.includes('error') || out.includes('fail') || out.includes('ssh') || out.includes('timeout')
    );
    expect(harness.daemonProcess).to.not.be.null;
  });

  // TC-T2-19: Handle permission denied errors
  it('TC-T2-19: Handle permission denied errors', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    const filePath = path.join(localPath, 'readonly.txt');
    fs.writeFileSync(filePath, 'readonly content');
    
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    // Make file read-only
    fs.chmodSync(filePath, 0o444);

    try {
      // Try modifying it
      fs.writeFileSync(filePath, 'attempt write');
    } catch (e) {
      // permission error expected, check if daemon continues
    }
    
    await delay(3500);
    expect(harness.daemonProcess).to.not.be.null;

    // restore permissions
    fs.chmodSync(filePath, 0o666);
  });

  // TC-T2-20: Handle empty repository state
  it('TC-T2-20: Handle empty repository state', async () => {
    // Create new repo without remote initially or commit
    const localRepoPath = path.join(harness.virtualDrivePath, 'repo_empty');
    fs.mkdirSync(localRepoPath, { recursive: true });

    harness.gitCmd(localRepoPath, ['init']);
    harness.gitCmd(localRepoPath, ['checkout', '-b', 'master']);
    harness.gitCmd(localRepoPath, ['config', 'user.name', 'E2ETester']);
    harness.gitCmd(localRepoPath, ['config', 'user.email', 'tester@e2e.local']);

    const bareRepoPath = path.join(harness.remotesPath, 'repo_empty.git');
    fs.mkdirSync(bareRepoPath, { recursive: true });
    harness.gitCmd(bareRepoPath, ['init', '--bare']);
    harness.gitCmd(localRepoPath, ['remote', 'add', 'origin', bareRepoPath]);

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    harness.createFile('repo_empty', 'first.txt', 'initial check');
    await delay(4000);

    // Check remote git log to verify initial commit and push succeeded
    const commitMsg = harness.gitCmd(bareRepoPath, ['log', '-1', '--pretty=%B']).stdout.trim();
    expect(commitMsg).to.match(/Auto-sync:/);
  });

  // TC-T2-21: Handle very large file addition
  it('TC-T2-21: Handle very large file addition', async () => {
    harness.createMockRepo('repo1', true);
    harness.startDaemon({ DEBOUNCE_DELAY: '1000' });
    await delay(500);

    // Write a large file (approx 60 MB) using stream or writing large buffer
    const largeFilePath = path.join(harness.virtualDrivePath, 'repo1', 'large.bin');
    const size = 60 * 1024 * 1024;
    const buffer = Buffer.alloc(1024 * 1024, 'x'); // 1MB buffer
    const stream = fs.createWriteStream(largeFilePath);
    for (let i = 0; i < 60; i++) {
      stream.write(buffer);
    }
    stream.end();

    await delay(8000); // wait for write and sync

    // Verify process doesn't crash
    expect(harness.daemonProcess).to.not.be.null;

    if (fs.existsSync(largeFilePath)) {
      fs.unlinkSync(largeFilePath);
    }
  });

  // TC-T2-22: Verify node installation check
  it('TC-T2-22: Verify node installation check', function () {
    const scriptPath = path.resolve(__dirname, '../../../install.ps1');
    if (!fs.existsSync(scriptPath)) {
      this.skip();
    }

    // Filter node.exe path out of env.PATH
    const pathParts = process.env.PATH.split(path.delimiter).filter(
      (p) => !fs.existsSync(path.join(p, 'node.exe'))
    );
    const env = { ...process.env, PATH: pathParts.join(path.delimiter) };

    const res = child_process.spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-TestMode'
    ], { env, encoding: 'utf8' });

    // installer should fail and log that Node.js is missing
    expect(res.status).to.not.equal(0);
    expect(res.stdout.toLowerCase() + res.stderr.toLowerCase()).to.satisfy(
      (out) => out.includes('node') || out.includes('not installed')
    );
  });

  // TC-T2-23: Verify installer doesn't overwrite existing logs
  it('TC-T2-23: Verify installer doesn\'t overwrite existing logs', function () {
    const scriptPath = path.resolve(__dirname, '../../../install.ps1');
    if (!fs.existsSync(scriptPath)) {
      this.skip();
    }

    const logFile = path.resolve(__dirname, '../../../sync.log');
    const existingContent = 'PRE-EXISTING-LOG-CONTENT';
    fs.writeFileSync(logFile, existingContent);

    child_process.spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-TestMode'
    ]);

    const content = fs.readFileSync(logFile, 'utf8');
    expect(content).to.include(existingContent);

    // clean log
    fs.writeFileSync(logFile, '');
  });

  // TC-T2-24: Verify launcher starts daemon with absolute paths
  it('TC-T2-24: Verify launcher starts daemon with absolute paths', function () {
    const launcherPath = path.resolve(__dirname, '../../../launcher.vbs');
    if (!fs.existsSync(launcherPath)) {
      this.skip();
    }

    const rootDir = path.resolve(__dirname, '../../..');
    const res = child_process.spawnSync('wscript.exe', [launcherPath], {
      cwd: 'C:\\', // run from separate working directory
      timeout: 5000
    });

    expect(res.status).to.equal(0);
  });

  // TC-T2-25: Verify verify_sync.ps1 cleanup
  it('TC-T2-25: Verify verify_sync.ps1 cleanup', function () {
    const verifyScriptPath = path.resolve(__dirname, '../../../verify_sync.ps1');
    if (!fs.existsSync(verifyScriptPath)) {
      this.skip();
    }

    child_process.spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', verifyScriptPath
    ]);

    // Check that there are no remaining test directories created by verify_sync.ps1
    // (e.g. temp repos should be cleaned up)
    const files = fs.readdirSync(path.resolve(__dirname, '../../..'));
    const tempRepos = files.filter((f) => f.includes('verify_sync_temp_'));
    expect(tempRepos.length).to.equal(0);
  });
});
