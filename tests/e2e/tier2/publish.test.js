const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const http = require('http');
const E2ETestHarness = require('../harness');

describe('Publish API Functional Tests', function () {
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

  it('TC-T2-28: Initialize and publish a local directory to a remote git repository', async () => {
    // 1. Create a non-git local directory with some files
    const localProjPath = path.join(harness.virtualDrivePath, 'local_proj_to_publish');
    fs.mkdirSync(localProjPath, { recursive: true });
    fs.writeFileSync(path.join(localProjPath, 'main.js'), 'console.log("hello world");');
    fs.writeFileSync(path.join(localProjPath, 'package.json'), JSON.stringify({ name: 'my-project', version: '1.0.0' }));

    // 2. Create a bare remote Git repository
    const mockRepoName = 'remote_publish_repo';
    const bareRepoPath = path.join(harness.remotesPath, mockRepoName + '.git');
    fs.mkdirSync(bareRepoPath, { recursive: true });
    harness.gitCmd(bareRepoPath, ['init', '--bare']);

    // Configure user info globally (or locally inside the test runner process env)
    // The harness already sets environment overrides so git uses the correct non-interactive configs.

    // 3. Start the daemon with the HTTP server enabled on port 3099
    harness.startDaemon({
      START_SERVER: 'true',
      PORT: '3099',
      DEBOUNCE_DELAY: '500'
    });
    await delay(1000);

    // 4. Make HTTP POST request to /api/publish
    const postData = JSON.stringify({
      localPath: localProjPath,
      remoteUrl: bareRepoPath
    });

    const options = {
      hostname: '127.0.0.1',
      port: 3099,
      path: '/api/publish',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    let responseData = '';
    const responsePromise = new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        expect(res.statusCode).to.equal(200);
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          resolve(responseData);
        });
      });

      req.on('error', (e) => {
        reject(e);
      });

      req.write(postData);
      req.end();
    });

    const result = await responsePromise;

    // 5. Verify the stdout/stderr stream contains expected milestones
    expect(result).to.include('[INFO] Starting publish sequence');
    expect(result).to.include('Running: git init');
    expect(result).to.include('Running: git add .');
    expect(result).to.include('Running: git commit');
    expect(result).to.include('Running: git push');
    expect(result).to.include('[SUCCESS] Project published successfully');

    // 6. Verify local path gets initialized with a git structure
    expect(fs.existsSync(path.join(localProjPath, '.git'))).to.be.true;

    // 7. Verify the remote repository has received the commit
    let commitMsg = '';
    try {
      commitMsg = harness.gitCmd(bareRepoPath, ['log', '-1', '--pretty=%B', 'main']).stdout.trim();
    } catch (err) {
      console.log('FAILED to read git log main:', err);
      console.log('DAEMON RESPONSE was:', result);
      throw err;
    }
    expect(commitMsg).to.equal('Initial commit from Auto-Sync Dashboard');
  });

  it('TC-T2-29: Block publish if local folder already has a .git folder', async () => {
    // Create a mock git repository in local path beforehand
    const localGitProj = harness.createMockRepo('existing_git_proj', true);

    harness.startDaemon({
      START_SERVER: 'true',
      PORT: '3099',
      DEBOUNCE_DELAY: '500'
    });
    await delay(1000);

    const postData = JSON.stringify({
      localPath: localGitProj,
      remoteUrl: 'https://github.com/phankhoa95/some-repo.git'
    });

    const options = {
      hostname: '127.0.0.1',
      port: 3099,
      path: '/api/publish',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const responsePromise = new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        expect(res.statusCode).to.equal(400);
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => resolve(JSON.parse(body)));
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    const resBody = await responsePromise;
    expect(resBody.success).to.be.false;
    expect(resBody.message).to.include('Local path already contains a .git directory');
  });
});
