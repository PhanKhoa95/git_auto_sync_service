const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');

async function testJunction() {
  const tempDir = os.tmpdir();
  const prefix = 'git-junction-test-' + Math.random().toString(36).substring(2, 10);
  const sandboxRoot = path.join(tempDir, prefix);
  fs.mkdirSync(sandboxRoot, { recursive: true });

  const virtualDrivePath = path.join(sandboxRoot, 'sandbox_e');
  fs.mkdirSync(virtualDrivePath, { recursive: true });

  const remotesPath = path.join(sandboxRoot, 'temp_remotes');
  fs.mkdirSync(remotesPath, { recursive: true });

  const logPath = path.join(virtualDrivePath, 'sync.log');

  const localRepoPath = path.join(virtualDrivePath, 'repo1');
  fs.mkdirSync(localRepoPath, { recursive: true });

  const gitCmd = (cwd, args) => {
    return child_process.spawnSync('git', args, { cwd, encoding: 'utf8' });
  };

  gitCmd(localRepoPath, ['init']);
  gitCmd(localRepoPath, ['checkout', '-b', 'master']);
  gitCmd(localRepoPath, ['config', 'user.name', 'JunctionTester']);
  gitCmd(localRepoPath, ['config', 'user.email', 'junction@tester.local']);

  const bareRepoPath = path.join(remotesPath, 'repo1.git');
  fs.mkdirSync(bareRepoPath, { recursive: true });
  gitCmd(bareRepoPath, ['init', '--bare']);

  fs.writeFileSync(path.join(localRepoPath, 'init.txt'), 'Initial');
  gitCmd(localRepoPath, ['add', 'init.txt']);
  gitCmd(localRepoPath, ['commit', '-m', 'Initial']);
  gitCmd(localRepoPath, ['remote', 'add', 'origin', bareRepoPath]);
  gitCmd(localRepoPath, ['push', '-u', 'origin', 'master']);

  // Create circular junction
  const junctionPath = path.join(localRepoPath, 'circular_junction');
  try {
    child_process.execSync(`cmd.exe /c mklink /j "${junctionPath}" "${localRepoPath}"`);
  } catch (e) {
    console.error('Failed to create junction:', e.message);
    return;
  }

  // Start daemon
  const daemonScript = path.resolve(__dirname, '../../src/index.js');
  const env = {
    ...process.env,
    TEST_E_DRIVE_PATH: virtualDrivePath,
    SYNC_LOG_PATH: logPath,
    DEBOUNCE_DELAY: '500',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never'
  };

  console.log('Spawning daemon...');
  let daemonOutput = '';
  const daemonProcess = child_process.spawn('node', [daemonScript], { env, cwd: virtualDrivePath });
  
  daemonProcess.stdout.on('data', (d) => { daemonOutput += d.toString(); });
  daemonProcess.stderr.on('data', (d) => { daemonOutput += d.toString(); });

  await new Promise(r => setTimeout(r, 1000));

  console.log('Writing test file...');
  fs.writeFileSync(path.join(localRepoPath, 'junction_test.txt'), 'junction test');

  await new Promise(r => setTimeout(r, 4000));

  console.log('Stopping daemon...');
  daemonProcess.kill();

  console.log('\n--- Daemon Output ---');
  console.log(daemonOutput);

  console.log('\n--- sync.log Content ---');
  if (fs.existsSync(logPath)) {
    console.log(fs.readFileSync(logPath, 'utf8'));
  } else {
    console.log('sync.log does not exist');
  }

  // Cleanup junction
  try {
    fs.rmdirSync(junctionPath);
  } catch (e) {}

  // Cleanup sandbox
  const removeDir = (dirPath) => {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach((file) => {
        const curPath = path.join(dirPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          removeDir(curPath);
        } else {
          try { fs.chmodSync(curPath, 0o666); } catch (e) {}
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(dirPath);
    }
  };
  removeDir(sandboxRoot);
}

testJunction();
