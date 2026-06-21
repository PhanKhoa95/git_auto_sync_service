const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const http = require('http');
const E2ETestHarness = require('../harness');

describe('Clone API Functional Tests', function () {
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

  it('TC-T2-26: Clone a repository via HTTP API and stream progress', async () => {
    // 1. Create a mock repository on the mock remote path
    const mockRepoName = 'repo_to_clone';
    harness.createMockRepo(mockRepoName, true);
    
    // The remote bare repository path
    const remoteRepoPath = path.join(harness.remotesPath, mockRepoName + '.git');

    // 2. Start the daemon with the HTTP server enabled on port 3091
    harness.startDaemon({
      START_SERVER: 'true',
      PORT: '3091',
      DEBOUNCE_DELAY: '500'
    });
    await harness.waitForDaemonReady();

    // 3. Make HTTP POST request to /api/clone
    const postData = JSON.stringify({
      cloneUrl: remoteRepoPath,
      rootPath: harness.virtualDrivePath,
      folderName: 'cloned_repo'
    });

    const options = {
      hostname: '127.0.0.1',
      port: 3091,
      path: '/api/clone',
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

    // 4. Verify stdout/stderr clone progress messages are streamed back
    expect(result).to.include('[INFO] Starting git clone');
    expect(result).to.include('[SUCCESS] Repository cloned successfully');

    // 5. Verify local repository exists and has init.txt
    const clonedLocalPath = path.join(harness.virtualDrivePath, 'cloned_repo');
    expect(fs.existsSync(clonedLocalPath)).to.be.true;
    expect(fs.existsSync(path.join(clonedLocalPath, '.git'))).to.be.true;
    expect(fs.existsSync(path.join(clonedLocalPath, 'init.txt'))).to.be.true;
    
    const initContent = fs.readFileSync(path.join(clonedLocalPath, 'init.txt'), 'utf8');
    expect(initContent).to.equal('Initial commit file');
  });

  it('TC-T2-27: Block clone if target folder already exists', async () => {
    // Create folder beforehand
    const conflictFolderPath = path.join(harness.virtualDrivePath, 'existing_folder');
    fs.mkdirSync(conflictFolderPath, { recursive: true });

    harness.startDaemon({
      START_SERVER: 'true',
      PORT: '3092',
      DEBOUNCE_DELAY: '500'
    });
    await harness.waitForDaemonReady();

    const postData = JSON.stringify({
      cloneUrl: 'https://github.com/phankhoa95/test.git',
      rootPath: harness.virtualDrivePath,
      folderName: 'existing_folder'
    });

    const options = {
      hostname: '127.0.0.1',
      port: 3092,
      path: '/api/clone',
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
    expect(resBody.message).to.include('Destination folder already exists');
  });
});
