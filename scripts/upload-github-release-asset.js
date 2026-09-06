const fs = require('fs');
const net = require('net');
const tls = require('tls');
const path = require('path');
const { execFileSync } = require('child_process');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const repo = arg('repo');
const releaseId = arg('release-id');
const file = arg('file');
const assetName = arg('name', file ? path.basename(file) : '');
const proxyUrl = arg('proxy', process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '');
const gh = arg('gh', path.join(process.cwd(), 'tmp', 'gh-cli', 'bin', 'gh.exe'));

if (!repo || !releaseId || !file || !assetName || !proxyUrl) {
  console.error('Usage: node scripts/upload-github-release-asset.js --repo owner/repo --release-id 123 --file path --name asset.zip --proxy http://127.0.0.1:32081');
  process.exit(2);
}

const stat = fs.statSync(file);
const token = execFileSync(gh, ['auth', 'token', '--hostname', 'github.com'], {
  encoding: 'utf8',
  env: process.env,
}).trim();

const proxy = new URL(proxyUrl);
const targetHost = 'uploads.github.com';
const targetPort = 443;
const requestPath = `/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;

function waitForConnectResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const marker = buffered.indexOf('\r\n\r\n');
      if (marker === -1) return;
      socket.off('data', onData);
      const head = buffered.slice(0, marker).toString('utf8');
      const rest = buffered.slice(marker + 4);
      if (!/^HTTP\/1\.[01] 200\b/.test(head)) {
        reject(new Error(`Proxy CONNECT failed:\n${head}`));
        return;
      }
      resolve(rest);
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

function connectProxy() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxy.port || 80), proxy.hostname, () => {
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        'Proxy-Connection: Keep-Alive\r\n' +
        '\r\n',
      );
      waitForConnectResponse(socket).then((rest) => resolve({ socket, rest }), reject);
    });
    socket.once('error', reject);
  });
}

function upload() {
  return new Promise(async (resolve, reject) => {
    let raw;
    try {
      raw = await connectProxy();
    } catch (error) {
      reject(error);
      return;
    }

    const secure = tls.connect({
      socket: raw.socket,
      servername: targetHost,
      ALPNProtocols: ['http/1.1'],
    });

    let response = Buffer.alloc(0);
    let uploaded = 0;
    let lastPrint = 0;
    let headerSent = false;

    secure.once('secureConnect', () => {
      const headers =
        `POST ${requestPath} HTTP/1.1\r\n` +
        `Host: ${targetHost}\r\n` +
        'User-Agent: VoiceAgentPadReleaseUploader/1.0\r\n' +
        `Authorization: Bearer ${token}\r\n` +
        'Accept: application/vnd.github+json\r\n' +
        'Content-Type: application/octet-stream\r\n' +
        `Content-Length: ${stat.size}\r\n` +
        'Connection: close\r\n' +
        '\r\n';
      secure.write(headers);
      headerSent = true;

      const input = fs.createReadStream(file);
      input.on('data', (chunk) => {
        uploaded += chunk.length;
        const now = Date.now();
        if (now - lastPrint > 2000 || uploaded === stat.size) {
          lastPrint = now;
          const percent = ((uploaded / stat.size) * 100).toFixed(1);
          process.stderr.write(`\r${assetName}: ${percent}% (${(uploaded / 1048576).toFixed(1)} / ${(stat.size / 1048576).toFixed(1)} MiB)`);
        }
      });
      input.once('error', reject);
      input.once('end', () => process.stderr.write('\n等待 GitHub 处理上传结果...\n'));
      input.pipe(secure, { end: false });
    });

    secure.on('data', (chunk) => {
      response = Buffer.concat([response, chunk]);
    });
    secure.once('error', (error) => {
      if (!headerSent) reject(error);
      else reject(error);
    });
    secure.once('end', () => {
      const text = response.toString('utf8');
      const match = text.match(/^HTTP\/1\.[01] (\d{3}) ([^\r\n]*)/);
      const status = match ? Number(match[1]) : 0;
      const body = text.slice(text.indexOf('\r\n\r\n') + 4);
      if (status >= 200 && status < 300) {
        resolve(body);
      } else {
        reject(new Error(`GitHub upload failed: HTTP ${status}\n${body || text}`));
      }
    });
  });
}

console.error(`开始上传 ${assetName}: ${(stat.size / 1048576).toFixed(2)} MiB`);
upload()
  .then((body) => {
    console.log(body);
  })
  .catch((error) => {
    console.error(error.stack || String(error));
    process.exit(1);
  });
