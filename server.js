#!/usr/bin/env node
/**
 * MikroTik Dashboard — Node.js backend (zero dependencies)
 */

const http  = require('http');
const https = require('https');
const path  = require('path');
const fs    = require('fs');
const crypto = require('crypto');
const { loadEnvOnce } = require('./config');

loadEnvOnce(__dirname);

if (!process.env.ROUTER_PASS) {
  console.warn('⚠️  WARNING: ROUTER_PASS is not provided in environment or .env file. Connection will likely fail.');
}

// ── Конфигурация ──────────────────────────────────────────────────────────────
const CFG = {
  host:     process.env.ROUTER_HOST || '',
  user:     process.env.ROUTER_USER || '',
  pass:     process.env.ROUTER_PASS || '',
  port:     Number(process.env.PORT) || 8080,
  poll:     Number(process.env.POLL_INTERVAL) || 3000,
  history:  Number(process.env.HISTORY_POINTS) || 60,
  auth:     process.env.DASHBOARD_TOKEN || '',
  routerTls: process.env.ROUTER_TLS === '1',
  allowInsecureTls: process.env.ALLOW_INSECURE_TLS === '1',
};
CFG.routerPort = Number(process.env.ROUTER_API_PORT) || (CFG.routerTls ? 443 : 80);

const missing = [];
if (!process.env.ROUTER_HOST) missing.push('ROUTER_HOST');
if (!process.env.ROUTER_USER) missing.push('ROUTER_USER');
if (!process.env.ROUTER_PASS) missing.push('ROUTER_PASS');
if (missing.length) {
  console.warn(`⚠️  Missing required config: ${missing.join(', ')}. Set these in .env or environment variables.`);
}

const AUTH_HDR = 'Basic ' + Buffer.from(`${CFG.user}:${CFG.pass}`).toString('base64');
const DIST_DIR = path.join(__dirname, 'public');

function createRouterClient(cfg) {
  const lib = cfg.routerTls ? https : http;

  function request(method, pathname, body) {
    return new Promise((resolve, reject) => {
      const opts = {
        hostname: cfg.host,
        port: cfg.routerPort,
        path: `/rest${pathname}`,
        method,
        headers: {
          Authorization: AUTH_HDR,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 5000,
        rejectUnauthorized: !cfg.allowInsecureTls,
      };

      const payload = body ? JSON.stringify(body) : null;
      if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);

      const req = lib.request(opts, res => {
        let responseBody = '';
        res.on('data', d => responseBody += d);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${responseBody.slice(0, 200)}`));
          }
          try { resolve(responseBody ? JSON.parse(responseBody) : null); }
          catch (_) { reject(new Error('JSON parse error: ' + responseBody.slice(0, 100))); }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
      if (payload) req.write(payload);
      req.end();
    });
  }

  return {
    get(pathname) {
      return request('GET', pathname);
    },
  };
}

const routerClient = createRouterClient(CFG);

// ── Session store ─────────────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000;

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { created: Date.now() });
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() - s.created > SESSION_TTL) { sessions.delete(token); return false; }
  return true;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (now - v.created > SESSION_TTL) sessions.delete(k);
  }
}
setInterval(cleanupSessions, 60 * 60 * 1000);

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(c => {
    const [k, ...rest] = c.trim().split('=');
    if (k) cookies[k.trim()] = rest.join('=');
  });
  return cookies;
}

function checkAuth(req, res) {
  if (!CFG.auth) return true;
  const cookies = parseCookies(req);
  if (validateSession(cookies.session)) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized', authRequired: true }));
  return false;
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 120;

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimit.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    entry = { start: now, count: 0 };
    rateLimit.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return false;
  return true;
}

function cleanupRateLimit() {
  const now = Date.now();
  for (const [k, v] of rateLimit) {
    if (now - v.start > RATE_LIMIT_WINDOW * 2) rateLimit.delete(k);
  }
}
setInterval(cleanupRateLimit, RATE_LIMIT_WINDOW * 2);

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

// ── История трафика ───────────────────────────────────────────────────────────
const trafficHistory = {};   // name → [{ts,rx,tx}, ...]
const prevBytes      = {};   // name → {ts,rx,tx}

// ── WebSocket (zero-dependency, RFC 6455) ─────────────────────────────────────
const wsClients = new Set();

function wsAccept(req) {
  const key = req.headers['sec-websocket-key'];
  if (!key) return null;
  const hash = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-5AB9ACB17A85').digest('base64');
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${hash}`,
    '', ''
  ].join('\r\n');
}

function wsSend(ws, obj) {
  const data = Buffer.from(JSON.stringify(obj));
  const len = data.length;
  let frame;
  if (len < 126) {
    frame = Buffer.allocUnsafe(2 + len);
    frame[0] = 0x81; frame[1] = len;
    data.copy(frame, 2);
  } else if (len < 65536) {
    frame = Buffer.allocUnsafe(4 + len);
    frame[0] = 0x81; frame[1] = 126;
    frame.writeUInt16BE(len, 2);
    data.copy(frame, 4);
  } else {
    frame = Buffer.allocUnsafe(10 + len);
    frame[0] = 0x81; frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    data.copy(frame, 10);
  }
  try { ws.write(frame); } catch(_) {}
}

function handleWsConnection(ws) {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
}

function broadcastUpdate(type, data) {
  if (!wsClients.size) return;
  for (const ws of wsClients) {
    wsSend(ws, { type, data, ts: Date.now() });
  }
}

// ── RouterOS REST helper ──────────────────────────────────────────────────────
function rosGet(pathname) {
  return routerClient.get(pathname);
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

// ── Report cache ──────────────────────────────────────────────────────────────
let reportCache = null;
const REPORT_CACHE_TTL = 30 * 1000;

async function apiReport() {
  if (reportCache && Date.now() - reportCache.ts < REPORT_CACHE_TTL) {
    return reportCache.data;
  }
  const [sys, ifaces, dhcp, vpn] = await Promise.all([
    apiSystem(), apiInterfaces(), apiDHCP(), apiVPN()
  ]);
  const data = { sys, ifaces, dhcp, vpn, timestamp: new Date().toLocaleString('ru-RU') };
  reportCache = { data, ts: Date.now() };
  return data;
}

async function apiHealthSummary() {
  try {
    const sys = await apiSystem();
    const pct = (used, total) => total > 0 ? (used / total) * 100 : 0;
    const memoryUsedPct = pct(sys.total_memory - sys.free_memory, sys.total_memory);
    const diskUsedPct = pct(sys.total_hdd - sys.free_hdd, sys.total_hdd);
    const temp = Number(sys.temperature);

    const checks = {
      cpu: { value: sys.cpu_load, status: sys.cpu_load > 85 ? 'critical' : (sys.cpu_load > 70 ? 'warning' : 'ok') },
      memory: { value: Number(memoryUsedPct.toFixed(1)), status: memoryUsedPct > 90 ? 'critical' : (memoryUsedPct > 80 ? 'warning' : 'ok') },
      disk: { value: Number(diskUsedPct.toFixed(1)), status: diskUsedPct > 95 ? 'critical' : (diskUsedPct > 85 ? 'warning' : 'ok') },
      temp: { value: Number.isFinite(temp) ? temp : null, status: !Number.isFinite(temp) ? 'unknown' : (temp > 75 ? 'critical' : (temp > 65 ? 'warning' : 'ok')) },
    };

    const alerts = [];
    if (checks.cpu.status !== 'ok') alerts.push(`CPU load ${checks.cpu.value}%`);
    if (checks.memory.status !== 'ok') alerts.push(`Memory used ${checks.memory.value}%`);
    if (checks.disk.status !== 'ok') alerts.push(`Disk used ${checks.disk.value}%`);
    if (checks.temp.status === 'critical') alerts.push(`Temperature ${checks.temp.value}°C`);
    if (checks.temp.status === 'warning') alerts.push(`Temperature high ${checks.temp.value}°C`);

    const severity = ['critical', 'warning', 'ok'].find(s =>
      Object.values(checks).some(c => c.status === s)
    ) || 'unknown';

    return {
      reachable: true,
      severity,
      alerts,
      checks,
      identity: sys.identity,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return {
      reachable: false,
      severity: 'critical',
      alerts: ['Router unreachable'],
      error: e.message,
      checks: {
        cpu: { status: 'unknown', value: null },
        memory: { status: 'unknown', value: null },
        disk: { status: 'unknown', value: null },
        temp: { status: 'unknown', value: null },
      },
      timestamp: new Date().toISOString(),
    };
  }
}

function apiTraffic() {
  const result = {};
  for (const [name, hist] of Object.entries(trafficHistory)) {
    result[name] = hist.slice(-CFG.history);
  }
  return result;
}

// ── Фоновый опрос трафика ─────────────────────────────────────────────────────
let polling = false;
async function pollTraffic() {
  if (polling) return;
  polling = true;
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
  } finally {
    polling = false;
    broadcastUpdate('traffic', apiTraffic());
  }
}

pollTraffic._interval = setInterval(pollTraffic, CFG.poll);
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
  '/api/health-summary': apiHealthSummary,
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (sslKey && sslCert) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
}

function isForbiddenStaticPath(urlPath) {
  const baseName = path.basename(urlPath || '');
  if (baseName.startsWith('.')) return true;
  return ['.env', '.pem', '.key', '.crt'].includes(baseName.toLowerCase());
}

function logAccess(req, statusCode) {
  const method = req.method || '-';
  const url = req.url || '-';
  const ip = getClientIp(req);
  const time = new Date().toISOString();
  console.log(`${ip} - [${time}] "${method} ${url}" ${statusCode}`);
}

const requestHandler = async (req, res) => {
  setSecurityHeaders(res);

  const clientIp = getClientIp(req);

  // Rate limit
  if (!checkRateLimit(clientIp)) {
    res.setHeader('Retry-After', '60');
    res.writeHead(429, { 'Content-Type': 'application/json' });
    logAccess(req, 429);
    res.end(JSON.stringify({ error: 'Too many requests' }));
    return;
  }

  // CORS
  const allowedOrigin = process.env.CORS_ORIGIN || `http://localhost:${CFG.port}`;
  const reqOrigin = req.headers.origin;
  if (reqOrigin && reqOrigin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = req.url.split('?')[0];

  // Login endpoint
  if (url === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body);
        if (token === CFG.auth) {
          const session = createSession();
          const cookieFlags = [
            `session=${session}`,
            'HttpOnly',
            'SameSite=Strict',
            `Max-Age=${SESSION_TTL / 1000}`,
            'Path=/',
          ];
          if (sslKey && sslCert) cookieFlags.push('Secure');
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': cookieFlags.join('; '),
          });
          logAccess(req, 200);
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          logAccess(req, 403);
          res.end(JSON.stringify({ error: 'Invalid token' }));
        }
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        logAccess(req, 400);
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return;
  }

  // Check if auth is required
  if (CFG.auth && url.startsWith('/api/') && url !== '/api/login') {
    if (!checkAuth(req, res)) { logAccess(req, 401); return; }
  }

  // API
  if (ROUTES[url]) {
    try {
      const data = await ROUTES[url]();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      logAccess(req, 200);
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      logAccess(req, 503);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Статика
  const filePath = path.join(DIST_DIR, url === '/' ? 'index.html' : url);
  const normalizedDist = path.resolve(DIST_DIR);
  const normalizedPath = path.resolve(filePath);
  if (!normalizedPath.startsWith(normalizedDist + path.sep) && normalizedPath !== normalizedDist) {
    res.writeHead(403); logAccess(req, 403); return res.end('Forbidden');
  }
  if (isForbiddenStaticPath(url)) {
    res.writeHead(403); logAccess(req, 403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST_DIR, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); logAccess(req, 404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        logAccess(req, 200);
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath);
    const types = { '.html':'text/html', '.js':'application/javascript',
                    '.css':'text/css', '.json':'application/json' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    logAccess(req, 200);
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

server.on('upgrade', (req, socket) => {
  if (CFG.auth) {
    const cookies = parseCookies(req);
    if (!validateSession(cookies.session)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  }
  if (req.headers.upgrade !== 'websocket') { socket.destroy(); return; }
  const handshake = wsAccept(req);
  if (!handshake) { socket.destroy(); return; }
  socket.write(handshake);
  socket.on('error', () => {});
  handleWsConnection(socket);
});

const listenHost = process.env.HOST || '127.0.0.1';
server.listen(CFG.port, listenHost, () => {
  const protocol = (sslKey && sslCert) ? 'https' : 'http';
  const routerProto = CFG.routerTls ? 'https' : 'http';
  console.log(`✓ MikroTik Dashboard: ${protocol}://${listenHost}:${CFG.port}`);
  console.log(`✓ RouterOS REST target: ${routerProto}://${CFG.host}:${CFG.routerPort}/rest`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down...`);
  server.close(() => {
    clearInterval(pollTraffic._interval);
    console.log('✓ Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('⚠ Force exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
