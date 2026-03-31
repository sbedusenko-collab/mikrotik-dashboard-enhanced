#!/usr/bin/env node
/**
 * MikroTik Dashboard — Node.js backend (zero dependencies)
 */

const http  = require('http');
const https = require('https');
const path  = require('path');
const fs    = require('fs');

try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach(l => {
    const m = l.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
} catch(e) {}

if (!process.env.ROUTER_PASS) {
  console.warn('⚠️  WARNING: ROUTER_PASS is not provided in environment or .env file. Connection will likely fail.');
}

// ── Конфигурация ──────────────────────────────────────────────────────────────
const CFG = {
  host:     process.env.ROUTER_HOST || '',
  user:     process.env.ROUTER_USER || '',
  pass:     process.env.ROUTER_PASS || '',
  port:     Number(process.env.PORT) || 8080,
  poll:     Number(process.env.POLL_INTERVAL) || 3000,   // мс
  history:  Number(process.env.HISTORY_POINTS) || 60,     // точек в rolling chart
};

const API_BASE  = `http://${CFG.host}/rest`;
const AUTH_HDR  = 'Basic ' + Buffer.from(`${CFG.user}:${CFG.pass}`).toString('base64');
const DIST_DIR  = path.join(__dirname);

// ── История трафика ───────────────────────────────────────────────────────────
const trafficHistory = {};   // name → [{ts,rx,tx}, ...]
const prevBytes      = {};   // name → {ts,rx,tx}

// ── RouterOS REST helper ──────────────────────────────────────────────────────
function rosGet(path) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}${path}`;
    const opts = {
      headers: { Authorization: AUTH_HDR, Accept: 'application/json' },
      timeout: 5000,
    };
    http.get(url, opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('JSON parse error: ' + body.slice(0, 100))); }
      });
    }).on('error', reject).on('timeout', function() {
      this.destroy(new Error('timeout'));
    });
  });
}

// ── API handlers ──────────────────────────────────────────────────────────────
async function apiSystem() {
  const [res, identity] = await Promise.all([
    rosGet('/system/resource'),
    rosGet('/system/identity'),
  ]);
  const r = Array.isArray(res) ? res[0] : res;
  const id = Array.isArray(identity) ? identity[0] : identity;
  return {
    identity:     id?.name ?? 'MikroTik',
    version:      r?.version ?? '',
    board:        r?.['board-name'] ?? '',
    uptime:       r?.uptime ?? '',
    cpu_load:     parseInt(r?.['cpu-load'] ?? 0),
    free_memory:  parseInt(r?.['free-memory'] ?? 0),
    total_memory: parseInt(r?.['total-memory'] ?? 1),
    free_hdd:     parseInt(r?.['free-hdd-space'] ?? 0),
    total_hdd:    parseInt(r?.['total-hdd-space'] ?? 1),
    temperature:  r?.['cpu-temperature'] ?? null,
  };
}

async function apiInterfaces() {
  const ifaces = await rosGet('/interface');
  return (Array.isArray(ifaces) ? ifaces : []).map(i => ({
    name:     i.name ?? '',
    type:     i.type ?? '',
    running:  i.running === 'true' || i.running === true,
    disabled: i.disabled === 'true' || i.disabled === true,
    rx_bytes: parseInt(i['rx-byte'] ?? 0),
    tx_bytes: parseInt(i['tx-byte'] ?? 0),
    rx_drop:  parseInt(i['rx-drop'] ?? 0),
    tx_drop:  parseInt(i['tx-drop'] ?? 0),
  }));
}

async function apiVPN() {
  const peers = await rosGet('/interface/wireguard/peers');
  return (Array.isArray(peers) ? peers : []).map(p => ({
    name:           p.interface ?? '',
    allowed:        p['allowed-address'] ?? '',
    last_handshake: p['last-handshake'] ?? '',
    rx_bytes:       parseInt(p.rx ?? 0),
    tx_bytes:       parseInt(p.tx ?? 0),
    connected:      !!p['last-handshake'],
  }));
}

async function apiDHCP() {
  const leases = await rosGet('/ip/dhcp-server/lease');
  return (Array.isArray(leases) ? leases : [])
    .map(l => ({
      address:  l.address ?? '',
      mac:      l['mac-address'] ?? '',
      hostname: l['host-name'] ?? '',
      status:   l.status ?? '',
      expires:  l['expires-after'] ?? '',
    }))
    .sort((a, b) => a.address.localeCompare(b.address));
}

async function apiRoutes() {
  const routes = await rosGet('/ip/route?active=true');
  return (Array.isArray(routes) ? routes : []).map(r => ({
    dst:      r['dst-address'] ?? '',
    gateway:  r.gateway ?? '',
    iface:    r.interface ?? '',
    distance: parseInt(r.distance ?? 0),
  }));
}

async function apiLogs() {
  const logs = await rosGet('/log');
  return Array.isArray(logs) ? logs.slice(-200) : [];
}

async function apiReport() {
  const [sys, ifaces, dhcp, vpn] = await Promise.all([
    apiSystem(), apiInterfaces(), apiDHCP(), apiVPN()
  ]);
  return { sys, ifaces, dhcp, vpn, timestamp: new Date().toLocaleString('ru') };
}

function apiTraffic() {
  const result = {};
  for (const [name, hist] of Object.entries(trafficHistory)) {
    result[name] = hist.slice(-CFG.history);
  }
  return result;
}

// ── Фоновый опрос трафика ─────────────────────────────────────────────────────
async function pollTraffic() {
  try {
    const ifaces = await rosGet('/interface');
    const now = Date.now() / 1000;
    if (!Array.isArray(ifaces)) return;

    for (const iface of ifaces) {
      const name = iface.name;
      if (!name) continue;
      const rx = parseInt(iface['rx-byte'] ?? 0);
      const tx = parseInt(iface['tx-byte'] ?? 0);

      if (prevBytes[name]) {
        const prev = prevBytes[name];
        const dt = now - prev.ts;
        if (dt > 0) {
          const rxRate = Math.max(0, (rx - prev.rx) / dt);
          const txRate = Math.max(0, (tx - prev.tx) / dt);
          if (!trafficHistory[name]) trafficHistory[name] = [];
          trafficHistory[name].push({ ts: now, rx: rxRate, tx: txRate });
          if (trafficHistory[name].length > CFG.history * 2)
            trafficHistory[name] = trafficHistory[name].slice(-CFG.history);
        }
      }
      prevBytes[name] = { ts: now, rx, tx };
    }
  } catch(e) {
    if (e.code !== 'ECONNREFUSED' && e.message !== 'timeout') {
      console.error(`[Traffic Poll] Error: ${e.message}`);
    }
  }
}

setInterval(pollTraffic, CFG.poll);
pollTraffic();

// ── HTTP сервер ───────────────────────────────────────────────────────────────
const ROUTES = {
  '/api/system':     apiSystem,
  '/api/interfaces': apiInterfaces,
  '/api/traffic':    () => Promise.resolve(apiTraffic()),
  '/api/vpn':        apiVPN,
  '/api/dhcp':       apiDHCP,
  '/api/routes':     apiRoutes,
  '/api/logs':       apiLogs,
  '/api/report':     apiReport,
};

const requestHandler = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || `http://localhost:${CFG.port}`);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = req.url.split('?')[0];

  // API
  if (ROUTES[url]) {
    try {
      const data = await ROUTES[url]();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Статика
  const filePath = path.join(DIST_DIR, url === '/' ? 'index.html' : url);
  const normalizedDist = path.resolve(DIST_DIR);
  const normalizedPath = path.resolve(filePath);
  if (!normalizedPath.startsWith(normalizedDist)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(DIST_DIR, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath);
    const types = { '.html':'text/html', '.js':'application/javascript',
                    '.css':'text/css', '.json':'application/json' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
};

const sslKey = process.env.SSL_KEY;
const sslCert = process.env.SSL_CERT;
let server;

if (sslKey && sslCert) {
  server = https.createServer({
    key: fs.readFileSync(sslKey),
    cert: fs.readFileSync(sslCert)
  }, requestHandler);
} else {
  server = http.createServer(requestHandler);
}

server.listen(CFG.port, '127.0.0.1', () => {
  const protocol = (sslKey && sslCert) ? 'https' : 'http';
  console.log(`✓ MikroTik Dashboard: ${protocol}://127.0.0.1:${CFG.port}`);
});
