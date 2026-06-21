const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const tempDir = require('os').tmpdir();
const sandbox = path.join(tempDir, 'git-debug-' + Math.random().toString(36).substring(2, 10));
fs.mkdirSync(sandbox);

const local = path.join(sandbox, 'local');
const remote = path.join(sandbox, 'remote.git');
fs.mkdirSync(local);
fs.mkdirSync(remote);

// Init
const git = (cwd, args) => {
  return new Promise((resolve, reject) => {
    const options = {
      cwd,
      shell: false,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_SSH_COMMAND: 'ssh -o ConnectTimeout=1 -o ConnectionAttempts=1'
      }
    };
    const gitArgs = [
      '-c', 'gc.auto=0',
      '-c', 'core.preloadindex=true',
      '-c', 'core.symlinks=true',
      ...args
    ];
    execFile('git', gitArgs, options, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
};

async function test() {
  try {
    console.log('Initializing remote bare repo...');
    execFile('git', ['init', '--bare'], { cwd: remote }, async (error, stdout, stderr) => {
      console.log('Init local repo...');
      await git(local, ['init']);
      await git(local, ['config', 'user.name', 'Tester']);
      await git(local, ['config', 'user.email', 'tester@test.com']);
      fs.writeFileSync(path.join(local, 'file.txt'), 'hello');
      await git(local, ['add', '-A']);
      await git(local, ['commit', '-m', 'initial']);
      await git(local, ['remote', 'add', 'origin', remote]);
      console.log('Pushing...');
      try {
        const res = await git(local, ['push', 'origin', 'master']);
        console.log('Push succeeded!', res);
      } catch (err) {
        console.log('Push failed!');
        console.log('Error:', err.error);
        console.log('Stdout:', JSON.stringify(err.stdout));
        console.log('Stderr:', JSON.stringify(err.stderr));
      }
      
      // Cleanup
      try {
        fs.rmSync(sandbox, { recursive: true, force: true });
      } catch(e) {}
    });
  } catch (e) {
    console.error(e);
  }
}

test();
