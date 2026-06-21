const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const E2ETestHarness = require('../harness');

describe('Tier 3 Integration & System Tests', function () {
  this.timeout(40000);
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

  // TC-T3-01: E2E multi-repository concurrent sync
  it('TC-T3-01: E2E multi-repository concurrent sync', async () => {
    harness.createMockRepo('repo1', true);
    // Create sub/repo2
    fs.mkdirSync(path.join(harness.virtualDrivePath, 'sub'), { recursive: true });
    harness.createMockRepo('sub/repo2', true);

    harness.startDaemon({ DEBOUNCE_DELAY: '1000' });
    await delay(500);

    // Modify both repositories concurrently
    harness.createFile('repo1', 'concurrent.txt', 'repo1 modify');
    harness.createFile('sub/repo2', 'concurrent.txt', 'repo2 modify');

    await delay(4500); // Wait for debounce and sync

    const remotePath1 = path.join(harness.remotesPath, 'repo1.git');
    const remotePath2 = path.join(harness.remotesPath, 'sub/repo2.git');

    const files1 = harness.gitCmd(remotePath1, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    const files2 = harness.gitCmd(remotePath2, ['ls-tree', '-r', 'master', '--name-only']).stdout;

    expect(files1).to.include('concurrent.txt');
    expect(files2).to.include('concurrent.txt');
  });

  // TC-T3-02: E2E sync with remote updates
  it('TC-T3-02: E2E sync with remote updates', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    const bareRepoPath = path.join(harness.remotesPath, 'repo1.git');

    // Clone and push a remote change first
    const peerRepoPath = path.join(harness.sandboxRoot, 'peer_repo');
    harness.gitCmd(harness.sandboxRoot, ['clone', bareRepoPath, 'peer_repo']);
    harness.gitCmd(peerRepoPath, ['config', 'user.name', 'PeerTester']);
    harness.gitCmd(peerRepoPath, ['config', 'user.email', 'peer@tester.local']);

    fs.writeFileSync(path.join(peerRepoPath, 'remote_update.txt'), 'remote content');
    harness.gitCmd(peerRepoPath, ['add', 'remote_update.txt']);
    harness.gitCmd(peerRepoPath, ['commit', '-m', 'remote commit']);
    harness.gitCmd(peerRepoPath, ['push', 'origin', 'master']);

    // Start daemon
    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    // Modify locally
    harness.createFile('repo1', 'local_update.txt', 'local content');
    await delay(4500); // Wait for sync

    // Local repo should now have both files
    const files = fs.readdirSync(localPath);
    expect(files).to.include('remote_update.txt');
    expect(files).to.include('local_update.txt');

    // Remote should also have local_update.txt
    const remoteFiles = harness.gitCmd(bareRepoPath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    expect(remoteFiles).to.include('local_update.txt');
  });

  // TC-T3-03: E2E offline-online transition
  it('TC-T3-03: E2E offline-online transition', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    const bareRepoPath = path.join(harness.remotesPath, 'repo1.git');

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    // 1. Simulate offline state: point remote to invalid path
    harness.gitCmd(localPath, ['remote', 'set-url', 'origin', 'invalid_remote_path_offline']);

    // 2. Modify local file (sync fails, logs error, but daemon continues)
    harness.createFile('repo1', 'offline_mod.txt', 'failed push');
    await delay(3500);
    expect(harness.readLog().toLowerCase()).to.include('error');

    // 3. Restore network: restore correct remote URL
    harness.gitCmd(localPath, ['remote', 'set-url', 'origin', bareRepoPath]);

    // 4. Modify file again to trigger another sync
    harness.createFile('repo1', 'online_mod.txt', 'success push');
    await delay(4500); // Wait for new sync

    // Verify remote has both files
    const remoteFiles = harness.gitCmd(bareRepoPath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    expect(remoteFiles).to.include('offline_mod.txt');
    expect(remoteFiles).to.include('online_mod.txt');
  });

  // TC-T3-04: Full install-to-run flow
  it('TC-T3-04: Full install-to-run flow', function () {
    const installScript = path.resolve(__dirname, '../../../install.ps1');
    const launcherScript = path.resolve(__dirname, '../../../launcher.vbs');

    if (!fs.existsSync(installScript) || !fs.existsSync(launcherScript)) {
      this.skip();
    }

    // Run installation
    const installRes = child_process.spawnSync('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', installScript,
      '-TestMode'
    ]);
    expect(installRes.status).to.equal(0);

    // Launch daemon using launcher
    const launcherRes = child_process.spawnSync('wscript.exe', [launcherScript], { timeout: 5000 });
    expect(launcherRes.status).to.equal(0);

    // Cleanup registry
    const cleanRegCmd = 'Remove-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "GitAutoSync_Test" -ErrorAction SilentlyContinue';
    child_process.spawnSync('powershell.exe', ['-Command', cleanRegCmd]);
  });

  // TC-T3-05: Symlink and directory junction handling
  it('TC-T3-05: Symlink and directory junction handling', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    
    // Create circular junction directory inside repo1 pointing to repo1 itself
    const junctionPath = path.join(localPath, 'circular_junction');
    try {
      fs.symlinkSync(localPath, junctionPath, 'junction');
    } catch (e) {
      // If junction creation fails (e.g. privilege or Windows config), try mklink via cmd
      try {
        child_process.execSync(`cmd.exe /c mklink /j "${junctionPath}" "${localPath}"`);
      } catch (err) {
        // If both fail, create a circular directory manually or skip
        this.skip();
      }
    }

    harness.startDaemon({ DEBOUNCE_DELAY: '500' });
    await delay(500);

    // Modify a file in repo1
    harness.createFile('repo1', 'junction_test.txt', 'junction content');
    await delay(3500);

    // Clean junction so cleanSandbox works
    if (fs.existsSync(junctionPath)) {
      try {
        fs.unlinkSync(junctionPath);
      } catch (e) {
        try {
          fs.rmdirSync(junctionPath);
        } catch (err) {}
      }
    }

    // Process should not infinite loop and should sync the file successfully
    expect(harness.daemonProcess).to.not.be.null;
    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    const files = harness.gitCmd(remotePath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    expect(files).to.include('junction_test.txt');
  });
});
