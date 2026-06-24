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

    const remotePath1 = path.join(harness.remotesPath, 'repo1.git');
    const remotePath2 = path.join(harness.remotesPath, 'sub/repo2.git');

    // Poll until both files appear in remote or timeout (25s)
    const start = Date.now();
    let files1 = '', files2 = '';
    while (Date.now() - start < 25000) {
      try {
        files1 = harness.gitCmd(remotePath1, ['ls-tree', '-r', 'master', '--name-only']).stdout;
        files2 = harness.gitCmd(remotePath2, ['ls-tree', '-r', 'master', '--name-only']).stdout;
        if (files1.includes('concurrent.txt') && files2.includes('concurrent.txt')) {
          break;
        }
      } catch (e) {}
      await delay(200);
    }

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

    // Poll until local_update.txt is pushed to remote origin
    const start = Date.now();
    while (Date.now() - start < 25000) {
      try {
        const remoteFiles = harness.gitCmd(bareRepoPath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
        if (remoteFiles.includes('local_update.txt')) {
          break;
        }
      } catch (e) {}
      await delay(200);
    }

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

    // 2. Simulate offline state: point remote to invalid path
    harness.gitCmd(localPath, ['remote', 'set-url', 'origin', 'invalid_remote_path_offline']);

    // 2. Modify local file (sync fails, logs error, but daemon continues)
    harness.createFile('repo1', 'offline_mod.txt', 'failed push');
    
    // Poll for log containing error
    const startOffline = Date.now();
    while (Date.now() - startOffline < 25000) {
      if (harness.readLog().toLowerCase().includes('error')) {
        break;
      }
      await delay(200);
    }
    expect(harness.readLog().toLowerCase()).to.include('error');

    // 3. Restore network: restore correct remote URL
    harness.gitCmd(localPath, ['remote', 'set-url', 'origin', bareRepoPath]);

    // 4. Modify file again to trigger another sync
    harness.createFile('repo1', 'online_mod.txt', 'success push');
    
    // Poll until online_mod.txt is in the remote
    const startOnline = Date.now();
    while (Date.now() - startOnline < 25000) {
      try {
        const remoteFiles = harness.gitCmd(bareRepoPath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
        if (remoteFiles.includes('online_mod.txt')) {
          break;
        }
      } catch (e) {}
      await delay(200);
    }

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
    
    // Poll until junction_test.txt is pushed to remote
    const startJunction = Date.now();
    const remotePath = path.join(harness.remotesPath, 'repo1.git');
    while (Date.now() - startJunction < 25000) {
      try {
        const remoteFiles = harness.gitCmd(remotePath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
        if (remoteFiles.includes('junction_test.txt')) {
          break;
        }
      } catch (e) {}
      await delay(200);
    }

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
    const files = harness.gitCmd(remotePath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    expect(files).to.include('junction_test.txt');
  });

  // TC-T3-06: E2E periodic remote pull
  it('TC-T3-06: E2E periodic remote pull', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    const bareRepoPath = path.join(harness.remotesPath, 'repo1.git');

    // Start daemon with REMOTE_PULL_INTERVAL = 2000 (2 seconds)
    harness.startDaemon({ DEBOUNCE_DELAY: '500', REMOTE_PULL_INTERVAL: '2000' });
    await harness.waitForDaemonReady();

    // Create a peer clone and push a remote change
    const peerRepoPath = path.join(harness.sandboxRoot, 'peer_repo');
    harness.gitCmd(harness.sandboxRoot, ['clone', bareRepoPath, 'peer_repo']);
    harness.gitCmd(peerRepoPath, ['config', 'user.name', 'PeerTester']);
    harness.gitCmd(peerRepoPath, ['config', 'user.email', 'peer@tester.local']);

    fs.writeFileSync(path.join(peerRepoPath, 'periodic_pulled.txt'), 'remote periodic content');
    harness.gitCmd(peerRepoPath, ['add', 'periodic_pulled.txt']);
    harness.gitCmd(peerRepoPath, ['commit', '-m', 'remote periodic commit']);
    harness.gitCmd(peerRepoPath, ['push', 'origin', 'master']);

    // Now, without making any local changes in repo1, the daemon on repo1 should pull this file automatically!
    // Let's poll repo1 to see if periodic_pulled.txt appears
    const start = Date.now();
    let fileAppeared = false;
    const localFilePath = path.join(localPath, 'periodic_pulled.txt');
    while (Date.now() - start < 15000) { // 15 seconds max wait
      if (fs.existsSync(localFilePath)) {
        fileAppeared = true;
        break;
      }
      await delay(200);
    }

    expect(fileAppeared).to.be.true;
    const content = fs.readFileSync(localFilePath, 'utf8');
    expect(content).to.equal('remote periodic content');
  });

  // TC-T3-07: Visual conflict resolver API integration
  it('TC-T3-07: Visual conflict resolver API integration', async () => {
    const localPath = harness.createMockRepo('repo1', true);
    const bareRepoPath = path.join(harness.remotesPath, 'repo1.git');

    // 1. Create a file in local repo and push it to remote
    const conflictFile = path.join(localPath, 'conflict.txt');
    fs.writeFileSync(conflictFile, 'Line 1: Base\nLine 2: Base\nLine 3: Base\n', 'utf8');
    harness.gitCmd(localPath, ['add', 'conflict.txt']);
    harness.gitCmd(localPath, ['commit', '-m', 'Add base conflict file']);
    harness.gitCmd(localPath, ['push', 'origin', 'master']);

    // 2. Setup peer repository and pull
    const peerRepoPath = path.join(harness.sandboxRoot, 'peer_repo');
    harness.gitCmd(harness.sandboxRoot, ['clone', bareRepoPath, 'peer_repo']);
    harness.gitCmd(peerRepoPath, ['config', 'user.name', 'PeerTester']);
    harness.gitCmd(peerRepoPath, ['config', 'user.email', 'peer@tester.local']);

    // 3. Make peer change and push
    const peerConflictFile = path.join(peerRepoPath, 'conflict.txt');
    fs.writeFileSync(peerConflictFile, 'Line 1: Base\nLine 2: Peer changes\nLine 3: Base\n', 'utf8');
    harness.gitCmd(peerRepoPath, ['add', 'conflict.txt']);
    harness.gitCmd(peerRepoPath, ['commit', '-m', 'Peer changes to line 2']);
    harness.gitCmd(peerRepoPath, ['push', 'origin', 'master']);

    // 4. Make local change and commit
    fs.writeFileSync(conflictFile, 'Line 1: Base\nLine 2: Local changes\nLine 3: Base\n', 'utf8');
    harness.gitCmd(localPath, ['add', 'conflict.txt']);
    harness.gitCmd(localPath, ['commit', '-m', 'Local changes to line 2']);

    // 5. Force merge conflict locally by pulling
    try {
      harness.gitCmd(localPath, ['pull', 'origin', 'master']);
    } catch (e) {
      // Pull will fail because of merge conflict
    }

    const mergeHeadPath = path.join(localPath, '.git', 'MERGE_HEAD');
    expect(fs.existsSync(mergeHeadPath)).to.be.true;

    // 6. Start the daemon with PORT 3095 and server enabled
    harness.startDaemon({
      START_SERVER: 'true',
      PORT: '3095',
      DEBOUNCE_DELAY: '1000'
    });
    await harness.waitForDaemonReady();

    const port = 3095;

    // Helper to make HTTP requests
    const makeRequest = (method, reqPath, body = null) => {
      const http = require('http');
      return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : '';
        const options = {
          hostname: '127.0.0.1',
          port,
          path: reqPath,
          method,
          headers: {}
        };
        if (body) {
          options.headers['Content-Type'] = 'application/json';
          options.headers['Content-Length'] = Buffer.byteLength(postData);
        }
        const req = http.request(options, (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve({ status: res.statusCode, data: parsed });
            } catch (e) {
              resolve({ status: res.statusCode, raw: data });
            }
          });
        });
        req.on('error', reject);
        if (body) req.write(postData);
        req.end();
      });
    };

    // 7. Verify /api/status shows conflict
    const statusRes = await makeRequest('GET', '/api/status');
    expect(statusRes.status).to.equal(200);
    const repos = statusRes.data.watchedRepositories;
    const repoInfo = repos[localPath];
    expect(repoInfo).to.not.be.undefined;
    expect(repoInfo.hasConflict).to.be.true;
    expect(repoInfo.conflictedFiles).to.include('conflict.txt');

    // 8. Verify /api/conflict-details returns raw content with conflict markers
    const detailsRes = await makeRequest('GET', `/api/conflict-details?repoPath=${encodeURIComponent(localPath)}&file=conflict.txt`);
    expect(detailsRes.status).to.equal(200);
    expect(detailsRes.data.success).to.be.true;
    expect(detailsRes.data.content).to.include('<<<<<<<');
    expect(detailsRes.data.content).to.include('=======');
    expect(detailsRes.data.content).to.include('>>>>>>>');

    // 9. Resolve conflict via POST /api/resolve-file-conflict (action: 'ours')
    const resolveRes = await makeRequest('POST', '/api/resolve-file-conflict', {
      repoPath: localPath,
      file: 'conflict.txt',
      action: 'ours'
    });
    expect(resolveRes.status).to.equal(200);
    expect(resolveRes.data.success).to.be.true;

    // Verify status updated and conflictedFiles list is empty
    const statusRes2 = await makeRequest('GET', '/api/status');
    expect(statusRes2.data.watchedRepositories[localPath].conflictedFiles).to.have.lengthOf(0);

    // 10. Complete merge via POST /api/complete-merge
    const completeRes = await makeRequest('POST', '/api/complete-merge', {
      repoPath: localPath
    });
    expect(completeRes.status).to.equal(200);
    expect(completeRes.data.success).to.be.true;

    // Verify MERGE_HEAD is gone
    expect(fs.existsSync(mergeHeadPath)).to.be.false;

    // Verify remote has the changes pushed
    const remoteFiles = harness.gitCmd(bareRepoPath, ['ls-tree', '-r', 'master', '--name-only']).stdout;
    expect(remoteFiles).to.include('conflict.txt');
  });
});

