#!/usr/bin/env node
/**
 * Find a WSL-reachable URL for the Windows Tandem API (:8765).
 * localhostForwarding should map 127.0.0.1, but Win10 + WSL2 sometimes
 * only answers on the Windows host IP from /etc/resolv.conf.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function windowsHostFromResolv(resolvText) {
  const match = String(resolvText || '').match(/^\s*nameserver\s+(\S+)/m);
  return match ? match[1] : null;
}

function candidateHosts(options = {}) {
  const hosts = ['127.0.0.1'];
  const extra = options.extraHosts || [];
  const resolv = options.resolvText ?? (fs.existsSync('/etc/resolv.conf') ? fs.readFileSync('/etc/resolv.conf', 'utf-8') : '');
  const windowsHost = windowsHostFromResolv(resolv);
  if (windowsHost) hosts.push(windowsHost);
  hosts.push('host.docker.internal');
  for (const host of extra) {
    if (host) hosts.push(host);
  }
  return [...new Set(hosts)];
}

function probeWindowsApi(options = {}) {
  const port = Number(options.port || process.env.TANDEM_API_PORT || 8765);
  const fetchImpl = options.fetchImpl;
  const hosts = candidateHosts(options);
  const tried = [];

  for (const host of hosts) {
    const url = `http://${host}:${port}`;
    const probeUrl = `${url}/status`;
    tried.push(probeUrl);
    try {
      if (fetchImpl) {
        const result = fetchImpl(probeUrl);
        if (result && result.ok) {
          return { ok: true, url, host, port, tried };
        }
        continue;
      }
      const result = spawnSync('curl', ['-sS', '-m', '2', '-o', '/dev/null', '-w', '%{http_code}', probeUrl], {
        encoding: 'utf-8',
      });
      const code = String(result.stdout || '').trim();
      if (result.status === 0 && /^[23]\d\d$/.test(code)) {
        return { ok: true, url, host, port, tried };
      }
    } catch {
      // try next host
    }
  }

  return { ok: false, url: null, host: null, port, tried };
}

module.exports = { candidateHosts, probeWindowsApi, windowsHostFromResolv };

if (require.main === module) {
  const rigPath = path.join(__dirname, 'rig.json');
  const rig = fs.existsSync(rigPath) ? JSON.parse(fs.readFileSync(rigPath, 'utf-8')) : {};
  const result = probeWindowsApi({ port: rig.tandem?.apiPort });
  if (result.ok) {
    console.log(result.url);
    process.exit(0);
  }
  console.error(`[gtx1660] Tandem API :${result.port} not reachable from WSL. Tried:\n${result.tried.join('\n')}`);
  process.exit(1);
}
