#!/usr/bin/env node
/**
 * MikroTik MCP Server — Node.js, zero external dependencies
 * Implements Model Context Protocol (MCP) 2024-11-05 over stdio
 * Compatible with Claude Code and any MCP-capable client
 */

'use strict';

const readline = require('readline');
const { exec } = require('child_process');
const { fmtBytes } = require('./utils');
const { loadEnvOnce } = require('./config');
const { rosGet, rosPost, rosPatch, rosPut, rosDelete } = require('./routeros-client');
const { buildUiUrl } = require('./routeros-tools-mcp');
const { previewDestructive } = require('./routeros-tools-security');

loadEnvOnce(__dirname);

// ── Server metadata ───────────────────────────────────────────────────────────
const SERVER_INFO      = { name: 'mikrotik-mcp', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

// ── Router connections ────────────────────────────────────────────────────────
const connections = new Map();  // alias → { address, auth, tls }
let   defaultRouter = null;

// ── RouterOS REST helper ──────────────────────────────────────────────────────

function getConn(router) {
  const key = router || defaultRouter;
  if (!key) throw new Error('No router connected. Use routeros_connect first.');
  const conn = connections.get(key);
  if (!conn) throw new Error(`Router "${key}" not found.`);
  return conn;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Formatting helpers ────────────────────────────────────────────────────────


function table(rows, headers) {
  if (!rows.length) return 'No items.';
  const cols = headers || Object.keys(rows[0]);
  const data = rows.map(r => cols.map(c => String(r[c] ?? '—')));
  const widths = cols.map((c, i) => Math.max(c.length, ...data.map(r => r[i].length)));
  const fmt = row => row.map((v, i) => v.padEnd(widths[i])).join('  ');
  return [fmt(cols), widths.map(w => '-'.repeat(w)).join('  '), ...data.map(fmt)].join('\n');
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function routeros_connect({ address, password, alias, use_tls }) {
  const trySsl = use_tls !== false && use_tls !== 'false';
  for (const tls of trySsl ? [true, false] : [false]) {
    const auth = 'Basic ' + Buffer.from(`MCP-User:${password}`).toString('base64');
    const conn = { address, auth, tls };
    try {
      const res = await rosGet(conn, '/system/identity');
      const id  = Array.isArray(res) ? res[0] : res;
      const key = alias || address;
      connections.set(key, conn);
      defaultRouter = key;
      return `✓ Connected to ${id?.name || address} [${address}] via ${tls ? 'HTTPS' : 'HTTP'}. Alias: "${key}"`;
    } catch(e) { if (!trySsl) throw e; }
  }
  throw new Error('Connection failed on both HTTPS and HTTP.');
}

function routeros_disconnect({ router }) {
  const key = router || defaultRouter;
  if (!key || !connections.has(key)) return 'No active connection.';
  connections.delete(key);
  if (defaultRouter === key) defaultRouter = connections.size ? [...connections.keys()][0] : null;
  return `Disconnected from "${key}".`;
}

function routeros_list_connections() {
  if (!connections.size) return 'No active connections. Use routeros_connect first.';
  return [...connections.entries()].map(([k, v]) =>
    `${k === defaultRouter ? '● ' : '○ '}${k}  →  ${v.address}  [${v.tls ? 'HTTPS' : 'HTTP'}]`
  ).join('\n');
}

async function routeros_system_info({ router }) {
  const conn = getConn(router);
  const [rRes, idRes] = await Promise.all([
    rosGet(conn, '/system/resource'),
    rosGet(conn, '/system/identity'),
  ]);
  const r  = Array.isArray(rRes)  ? rRes[0]  : rRes;
  const id = Array.isArray(idRes) ? idRes[0] : idRes;
  const memUsed  = parseInt(r['total-memory']) - parseInt(r['free-memory']);
  const diskUsed = parseInt(r['total-hdd-space']) - parseInt(r['free-hdd-space']);
  const memPct   = (memUsed  / parseInt(r['total-memory'])    * 100).toFixed(1);
  const diskPct  = (diskUsed / parseInt(r['total-hdd-space']) * 100).toFixed(1);
  return [
    `Identity  : ${id?.name}`,
    `Board     : ${r['board-name']}  (${r.architecture})`,
    `RouterOS  : ${r.version}`,
    `Uptime    : ${r.uptime}`,
    `CPU       : ${r['cpu-load']}%  (${r['cpu-count']} core × ${r['cpu-frequency']} MHz)`,
    `Memory    : ${fmtBytes(memUsed)} / ${fmtBytes(r['total-memory'])}  (${memPct}% used)`,
    `Storage   : ${fmtBytes(diskUsed)} / ${fmtBytes(r['total-hdd-space'])}  (${diskPct}% used)`,
    r['cpu-temperature'] ? `Temp      : ${r['cpu-temperature']}°C` : null,
  ].filter(Boolean).join('\n');
}

async function routeros_health_check({ router }) {
  const conn = getConn(router);
  const issues = [], ok = [];
  const [rRes, hRes] = await Promise.allSettled([
    rosGet(conn, '/system/resource'),
    rosGet(conn, '/system/health'),
  ]);
  if (rRes.status === 'fulfilled') {
    const r = Array.isArray(rRes.value) ? rRes.value[0] : rRes.value;
    const cpu    = parseInt(r['cpu-load']);
    const memPct = (1 - parseInt(r['free-memory'])    / parseInt(r['total-memory']))    * 100;
    const dskPct = (1 - parseInt(r['free-hdd-space']) / parseInt(r['total-hdd-space'])) * 100;
    cpu    > 80 ? issues.push(`⚠ CPU ${cpu}%`)                   : ok.push(`✓ CPU ${cpu}%`);
    memPct > 85 ? issues.push(`⚠ Memory ${memPct.toFixed(1)}%`)  : ok.push(`✓ Memory ${memPct.toFixed(1)}%`);
    dskPct > 90 ? issues.push(`⚠ Disk ${dskPct.toFixed(1)}%`)    : ok.push(`✓ Disk ${dskPct.toFixed(1)}%`);
  }
  if (hRes.status === 'fulfilled') {
    const sensors = Array.isArray(hRes.value) ? hRes.value : [];
    sensors.forEach(s => {
      const v = parseFloat(s.value);
      if ((s.name||'').includes('temp')) {
        v > 70 ? issues.push(`⚠ Temp ${v}°C`) : ok.push(`✓ Temp ${v}°C`);
      }
    });
  }
  return [
    issues.length ? `ISSUES (${issues.length}):\n` + issues.join('\n') : 'No critical issues.',
    `\nPASSED:\n` + ok.join('\n'),
  ].join('\n');
}

async function routeros_list({ path, props, query, router }) {
  const conn = getConn(router);
  let url = path;
  const ps = [];
  if (props) ps.push('.proplist=' + props);
  if (query) ps.push(query);
  if (ps.length) url += '?' + ps.join('&');
  const res  = await rosGet(conn, url);
  const list = Array.isArray(res) ? res : [res];
  if (!list.length) return 'No items.';
  const keys = props ? props.split(',') : Object.keys(list[0]).filter(k => k !== '.id');
  return table(list.map(r => Object.fromEntries(keys.map(k => [k, r[k]]))), keys);
}

async function routeros_get({ path, id, router }) {
  const conn = getConn(router);
  const res = await rosGet(conn, `${path}/${id}`);
  const obj = Array.isArray(res) ? res[0] : res;
  return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join('\n');
}

async function routeros_set({ path, id, values, router, confirm, dry_run }) {
  const preview = previewDestructive({ action: 'update', dry_run, confirm, preview: `would update ${path}/${id} with values ${JSON.stringify(values || {})}` });
  if (preview) return preview;
  const conn = getConn(router);
  await rosPatch(conn, `${path}/${id}`, values);
  return `✓ Updated ${path}/${id}`;
}

async function routeros_add({ path, values, router }) {
  const conn = getConn(router);
  const res = await rosPut(conn, path, values);
  return `✓ Added to ${path}` + (res?.['.id'] ? `  id=${res['.id']}` : '');
}

async function routeros_remove({ path, id, router, confirm, dry_run }) {
  const preview = previewDestructive({ action: 'remove', dry_run, confirm, preview: `would remove ${path}/${id}` });
  if (preview) return preview;
  const conn = getConn(router);
  await rosDelete(conn, `${path}/${id}`);
  return `✓ Removed ${path}/${id}`;
}

async function routeros_enable({ path, id, router }) {
  const conn = getConn(router);
  await rosPost(conn, `${path}/${id}/enable`, {});
  return `✓ Enabled ${path}/${id}`;
}

async function routeros_disable({ path, id, router }) {
  const conn = getConn(router);
  await rosPost(conn, `${path}/${id}/disable`, {});
  return `✓ Disabled ${path}/${id}`;
}

async function routeros_bulk({ operations, router, confirm, dry_run }) {
  const conn = getConn(router);
  const results = [];
  for (const op of (operations || [])) {
    try {
      const method = String(op.method || 'GET').toUpperCase();
      const isDestructive = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
      if (isDestructive) {
        const preview = previewDestructive({
          action: `bulk ${method}`,
          dry_run,
          confirm,
          preview: `would execute ${method} ${op.path}`,
        });
        if (preview) { results.push(preview); continue; }
      }
      if (method === 'GET') await rosGet(conn, op.path);
      else if (method === 'POST') await rosPost(conn, op.path, op.body);
      else if (method === 'PATCH') await rosPatch(conn, op.path, op.body);
      else if (method === 'PUT') await rosPut(conn, op.path, op.body);
      else if (method === 'DELETE') await rosDelete(conn, op.path);
      results.push(`✓ ${op.method} ${op.path}`);
    } catch(e) {
      results.push(`✗ ${op.method} ${op.path}: ${e.message}`);
    }
  }
  return results.join('\n');
}

async function routeros_export({ path, router }) {
  const conn = getConn(router);
  const sections = path ? [path] : [
    '/ip/address', '/ip/firewall/filter', '/ip/firewall/nat',
    '/ip/route', '/ip/dns', '/interface',
    '/ip/dhcp-server', '/ip/pool',
    '/interface/wireguard', '/interface/wireguard/peers',
  ];
  const out = [];
  for (const s of sections) {
    try {
      const res  = await rosGet(conn, s);
      const list = Array.isArray(res) ? res : [res];
      if (list.length) out.push(`# ${s}\n` + JSON.stringify(list, null, 2));
    } catch(e) { process.stderr.write(`[Export] Error on ${s}: ${e.message}\n`); }
  }
  return out.join('\n\n') || 'Nothing to export.';
}

async function routeros_backup({ name, router }) {
  const conn = getConn(router);
  const fname = name || `backup-${new Date().toISOString().slice(0, 10)}`;
  await rosPost(conn, '/system/backup/save', { name: fname });
  await sleep(2000);
  return `✓ Backup saved as "${fname}.backup" on the router.`;
}

async function routeros_ping({ address, count, router }) {
  const conn = getConn(router);
  const n = parseInt(count) || 4;
  const res = await rosPost(conn, '/ping', { address, count: String(n) });
  if (Array.isArray(res) && res.length) {
    const lines = res.map(r => `seq=${r.seq}  time=${r.time || r['time-ms'] || '—'}ms  ${r.host || address}`);
    const last  = res[res.length - 1];
    if (last?.['avg-rtt']) lines.push(`\nAvg: ${last['avg-rtt']}ms  Loss: ${last['packet-loss'] || 0}%`);
    return lines.join('\n');
  }
  return JSON.stringify(res, null, 2);
}

async function routeros_traceroute({ address, router }) {
  const conn = getConn(router);
  try {
    const res = await rosPost(conn, '/tool/traceroute', { address, count: '1' });
    if (Array.isArray(res)) {
      return res.map(h => `${String(h.n||h['#']||'').padStart(2)}  ${(h.address||'*').padEnd(20)}  ${h.time||'—'}ms  ${h.status||''}`.trimEnd()).join('\n');
    }
  } catch(e) { process.stderr.write(`[Traceroute] Error: ${e.message}\n`); }
  return 'Traceroute not available via REST API on this RouterOS version.';
}

async function routeros_monitor_traffic({ interface: iface, duration, router }) {
  const conn = getConn(router);
  const secs = Math.min(parseInt(duration) || 5, 30);
  const samples = [];
  for (let i = 0; i <= secs; i++) {
    const res  = await rosGet(conn, `/interface?name=${encodeURIComponent(iface)}`);
    const list = Array.isArray(res) ? res : [res];
    const item = list.find(x => x.name === iface) || list[0];
    if (item) samples.push({ ts: Date.now() / 1000, rx: parseInt(item['rx-byte'] || 0), tx: parseInt(item['tx-byte'] || 0) });
    if (i < secs) await sleep(1000);
  }
  const rates = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].ts - samples[i - 1].ts;
    rates.push({
      rx: ((samples[i].rx - samples[i - 1].rx) / dt * 8 / 1000).toFixed(1),
      tx: ((samples[i].tx - samples[i - 1].tx) / dt * 8 / 1000).toFixed(1),
    });
  }
  if (!rates.length) return 'No data.';
  const avgRx = (rates.reduce((s, r) => s + parseFloat(r.rx), 0) / rates.length).toFixed(1);
  const avgTx = (rates.reduce((s, r) => s + parseFloat(r.tx), 0) / rates.length).toFixed(1);
  return [
    `Interface: ${iface}  (${secs}s sample)`,
    '',
    ...rates.map((r, i) => `t+${i + 1}s  ↓ RX ${r.rx} kbps   ↑ TX ${r.tx} kbps`),
    `\nAverage:  ↓ RX ${avgRx} kbps   ↑ TX ${avgTx} kbps`,
  ].join('\n');
}

async function routeros_top_talkers({ limit, router }) {
  const conn = getConn(router);
  const res  = await rosGet(conn, '/interface');
  const list = (Array.isArray(res) ? res : [])
    .map(i => ({ name: i.name, type: i.type, rx: parseInt(i['rx-byte'] || 0), tx: parseInt(i['tx-byte'] || 0) }))
    .sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx))
    .slice(0, parseInt(limit) || 10);
  return table(list.map(i => ({
    Interface: i.name, Type: i.type,
    'RX Total': fmtBytes(i.rx), 'TX Total': fmtBytes(i.tx),
    'Total': fmtBytes(i.rx + i.tx),
  })));
}

async function routeros_firewall_analyze({ router }) {
  const conn = getConn(router);
  const [fRes, nRes, mRes] = await Promise.allSettled([
    rosGet(conn, '/ip/firewall/filter'),
    rosGet(conn, '/ip/firewall/nat'),
    rosGet(conn, '/ip/firewall/mangle'),
  ]);
  const lines = [];
  if (fRes.status === 'fulfilled') {
    const rules  = Array.isArray(fRes.value) ? fRes.value : [];
    const chains = {};
    rules.forEach(r => { chains[r.chain] = (chains[r.chain] || 0) + 1; });
    lines.push(`Filter rules: ${rules.length}`);
    Object.entries(chains).forEach(([c, n]) => lines.push(`  ${c}: ${n}`));
    const broad = rules.filter(r => r.action === 'accept' && !r['src-address'] && !r['dst-address'] && !r.protocol);
    if (broad.length) lines.push(`  ⚠ ${broad.length} broad accept rule(s) — review these`);
  }
  if (nRes.status === 'fulfilled') {
    const rules = Array.isArray(nRes.value) ? nRes.value : [];
    lines.push(`\nNAT rules: ${rules.length}`);
    rules.filter(r => r.action === 'masquerade').forEach(r =>
      lines.push(`  masquerade  out-iface=${r['out-interface'] || 'any'}`)
    );
    rules.filter(r => r.action === 'dst-nat').forEach(r =>
      lines.push(`  dst-nat  ${r.protocol || '*'}:${r['dst-port'] || '*'} → ${r['to-addresses']}:${r['to-ports'] || ''}`)
    );
  }
  if (mRes.status === 'fulfilled') {
    const rules = Array.isArray(mRes.value) ? mRes.value : [];
    if (rules.length) lines.push(`\nMangle rules: ${rules.length}`);
  }
  return lines.join('\n');
}

async function routeros_firewall_move({ path, id, destination, router }) {
  const conn = getConn(router);
  await rosPost(conn, `${path}/move`, { numbers: id, destination: String(destination) });
  return `✓ Moved rule ${id} to position ${destination} in ${path}`;
}

async function routeros_security_audit({ router }) {
  const conn = getConn(router);
  const issues = [], ok = [];
  const [svcR, usrR, fwR, resR] = await Promise.allSettled([
    rosGet(conn, '/ip/service'),
    rosGet(conn, '/user'),
    rosGet(conn, '/ip/firewall/filter'),
    rosGet(conn, '/system/resource'),
  ]);
  if (svcR.status === 'fulfilled') {
    const svcs    = Array.isArray(svcR.value) ? svcR.value : [];
    const enabled = svcs.filter(s => s.disabled !== 'true');
    ['telnet', 'ftp', 'api'].forEach(name => {
      if (enabled.find(s => s.name === name)) issues.push(`⚠ Insecure service enabled: ${name}`);
    });
    const http = enabled.find(s => s.name === 'www');
    if (http) issues.push(`⚠ Unencrypted HTTP web interface on port ${http.port}`);
    else ok.push('✓ HTTP disabled');
    const apiSsl = enabled.find(s => s.name === 'api-ssl');
    if (apiSsl) ok.push(`✓ API-SSL enabled on port ${apiSsl.port}`);
  }
  if (usrR.status === 'fulfilled') {
    const users = Array.isArray(usrR.value) ? usrR.value : [];
    if (users.find(u => u.name === 'admin')) issues.push('⚠ Default "admin" user exists');
    else ok.push('✓ No default admin user');
    const noPass = users.filter(u => !u.password || u.password === '');
    if (noPass.length) issues.push(`⚠ Users without password: ${noPass.map(u => u.name).join(', ')}`);
    ok.push(`✓ Users: ${users.map(u => u.name).join(', ')}`);
  }
  if (fwR.status === 'fulfilled') {
    const rules = Array.isArray(fwR.value) ? fwR.value : [];
    rules.length ? ok.push(`✓ Firewall: ${rules.length} rules`) : issues.push('⚠ No firewall rules');
    rules.find(r => r.chain === 'input' && r.action === 'drop')
      ? ok.push('✓ Input chain has drop rule')
      : issues.push('⚠ No default-drop in input chain');
  }
  if (resR.status === 'fulfilled') {
    const r = Array.isArray(resR.value) ? resR.value[0] : resR.value;
    ok.push(`✓ RouterOS ${r.version}`);
  }
  const score = Math.max(0, 100 - issues.length * 15);
  return [`Security score: ${score}/100\n`,
    issues.length ? 'FINDINGS:\n' + issues.join('\n') + '\n' : '',
    'PASSED:\n' + ok.join('\n'),
  ].join('');
}

async function routeros_dhcp_report({ router }) {
  const conn = getConn(router);
  const [srvR, lsR] = await Promise.allSettled([
    rosGet(conn, '/ip/dhcp-server'),
    rosGet(conn, '/ip/dhcp-server/lease'),
  ]);
  const lines = [];
  if (srvR.status === 'fulfilled') {
    const list = Array.isArray(srvR.value) ? srvR.value : [];
    lines.push(`Servers: ${list.length}`);
    list.forEach(s => lines.push(
      `  ${s.name}  pool=${s['address-pool']}  iface=${s.interface}  ${s.disabled === 'true' ? '[disabled]' : '[active]'}`
    ));
  }
  if (lsR.status === 'fulfilled') {
    const list  = Array.isArray(lsR.value) ? lsR.value : [];
    const bound = list.filter(l => l.status === 'bound').length;
    lines.push(`\nLeases: ${list.length} total  (${bound} bound)`);
    list.forEach(l => lines.push(
      `  ${(l.address || '').padEnd(16)}  ${(l['host-name'] || '—').padEnd(22)}  ${l['mac-address'] || ''}  [${l.status}]`
    ));
  }
  return lines.join('\n');
}

async function routeros_pool_status({ router }) {
  const conn = getConn(router);
  const [pRes, lRes] = await Promise.allSettled([
    rosGet(conn, '/ip/pool'),
    rosGet(conn, '/ip/dhcp-server/lease'),
  ]);
  const lines = [];
  if (pRes.status === 'fulfilled') {
    const pools  = Array.isArray(pRes.value) ? pRes.value : [];
    const leases = lRes.status === 'fulfilled' ? (Array.isArray(lRes.value) ? lRes.value : []) : [];
    const bound  = leases.filter(l => l.status === 'bound').length;
    lines.push(`IP Pools: ${pools.length}`);
    pools.forEach(p => lines.push(`  ${p.name}  ${p.ranges}  used≈${bound}`));
  }
  return lines.join('\n') || 'No pools.';
}

async function routeros_dns_status({ router }) {
  const conn = getConn(router);
  const [cfgR, cacheR] = await Promise.allSettled([
    rosGet(conn, '/ip/dns'),
    rosGet(conn, '/ip/dns/cache'),
  ]);
  const lines = [];
  if (cfgR.status === 'fulfilled') {
    const c = Array.isArray(cfgR.value) ? cfgR.value[0] : cfgR.value;
    lines.push('DNS Configuration:');
    lines.push(`  Servers    : ${c.servers || '—'}`);
    lines.push(`  Dynamic    : ${c['dynamic-server'] || '—'}`);
    lines.push(`  Cache TTL  : ${c['cache-max-ttl'] || '—'}`);
    lines.push(`  Cache size : ${c['cache-size'] || '—'} KB  (used: ${c['cache-used'] || '—'} KB)`);
  }
  if (cacheR.status === 'fulfilled') {
    const entries = Array.isArray(cacheR.value) ? cacheR.value : [];
    lines.push(`\nCache: ${entries.length} entries`);
    entries.slice(0, 15).forEach(e => lines.push(`  ${(e.name || '').padEnd(35)}  ${e.address || e.type || ''}`));
    if (entries.length > 15) lines.push(`  ... and ${entries.length - 15} more`);
  }
  return lines.join('\n');
}

async function routeros_dns_static_list({ router }) {
  const conn = getConn(router);
  const res  = await rosGet(conn, '/ip/dns/static');
  const list = Array.isArray(res) ? res : [];
  if (!list.length) return 'No static DNS entries.';
  return table(list.map(e => ({
    '.id': e['.id'], Name: e.name || '', Address: e.address || e.cname || e.type || '',
    TTL: e.ttl || '—', Disabled: e.disabled === 'true' ? 'yes' : '',
  })));
}

async function routeros_dns_static_add({ name, address, ttl, router }) {
  const conn = getConn(router);
  const body = { name, address };
  if (ttl) body.ttl = ttl;
  await rosPut(conn, '/ip/dns/static', body);
  return `✓ Added static DNS: ${name} → ${address}`;
}

async function routeros_dns_static_remove({ id, router }) {
  const conn = getConn(router);
  await rosDelete(conn, `/ip/dns/static/${id}`);
  return `✓ Removed static DNS entry ${id}`;
}

async function routeros_dns_cache_flush({ router }) {
  const conn = getConn(router);
  await rosPost(conn, '/ip/dns/cache/flush', {});
  return '✓ DNS cache flushed.';
}

async function routeros_vpn_status({ router }) {
  const conn = getConn(router);
  const [ifR, pR] = await Promise.allSettled([
    rosGet(conn, '/interface/wireguard'),
    rosGet(conn, '/interface/wireguard/peers'),
  ]);
  const lines = [];
  if (ifR.status === 'fulfilled') {
    const list = Array.isArray(ifR.value) ? ifR.value : [];
    lines.push(`WireGuard interfaces: ${list.length}`);
    list.forEach(i => lines.push(
      `  ${i.name}  port=${i['listen-port']}  mtu=${i.mtu || 'auto'}  ${i.running === 'true' ? '● up' : '○ down'}`
    ));
  }
  if (pR.status === 'fulfilled') {
    const list      = Array.isArray(pR.value) ? pR.value : [];
    const connected = list.filter(p => p['last-handshake']).length;
    lines.push(`\nPeers: ${list.length} total, ${connected} connected`);
    list.forEach(p => {
      const hs = p['last-handshake'];
      const st = !hs ? '🔴 never' : hs.match(/^\d+s$/) && parseInt(hs) < 180 ? '🟢 active' : '🟡 idle';
      lines.push(
        `  ${(p.interface || '').padEnd(12)}  ${(p['allowed-address'] || '').padEnd(22)}  hs=${hs || '—'}  ${st}`
      );
    });
  }
  return lines.join('\n');
}

async function routeros_wireguard_client_config({ peer_id, router }) {
  const conn = getConn(router);
  const [ifR, pR] = await Promise.allSettled([
    rosGet(conn, '/interface/wireguard'),
    rosGet(conn, '/interface/wireguard/peers'),
  ]);
  const peers = pR.status === 'fulfilled' ? (Array.isArray(pR.value) ? pR.value : []) : [];
  const peer  = peer_id
    ? peers.find(p => p['.id'] === peer_id || (p['allowed-address'] || '').includes(peer_id))
    : peers[0];
  if (!peer) return 'Peer not found. Use routeros_vpn_status to list peers.';
  const ifaces = ifR.status === 'fulfilled' ? (Array.isArray(ifR.value) ? ifR.value : []) : [];
  const iface  = ifaces.find(i => i.name === peer.interface) || ifaces[0];
  return [
    '[Interface]',
    '# PrivateKey = <paste client private key here>',
    `Address = ${peer['allowed-address'] || '10.0.0.2/24'}`,
    `DNS = ${conn.address}`,
    '',
    '[Peer]',
    `PublicKey = ${iface?.['public-key'] || '<server public key>'}`,
    `AllowedIPs = 0.0.0.0/0, ::/0`,
    `Endpoint = ${conn.address}:${iface?.['listen-port'] || '51820'}`,
    `PersistentKeepalive = 25`,
  ].join('\n');
}

async function routeros_wifi_status({ router }) {
  const conn = getConn(router);
  const lines = [];
  for (const p of ['/interface/wifi', '/interface/wireless']) {
    try {
      const res = await rosGet(conn, p);
      const list = Array.isArray(res) ? res : [];
      if (list.length) {
        lines.push(`WiFi interfaces (${p}):`);
        list.forEach(i => lines.push(
          `  ${(i.name || '').padEnd(12)}  ssid=${i.ssid || '—'}  ${i.running === 'true' ? '● up' : '○ down'}`
        ));
      }
    } catch(e) { process.stderr.write(`[WiFi 1] Error on ${p}: ${e.message}\n`); }
  }
  for (const p of ['/interface/wifi/registration-table', '/interface/wireless/registration-table']) {
    try {
      const res = await rosGet(conn, p);
      const list = Array.isArray(res) ? res : [];
      if (list.length) {
        lines.push(`\nClients: ${list.length}`);
        list.forEach(c => lines.push(
          `  ${(c['mac-address'] || '').padEnd(18)}  iface=${c.interface || '—'}  rssi=${c['signal-strength'] || '—'}`
        ));
      }
    } catch(e) { process.stderr.write(`[WiFi 2] Error on ${p}: ${e.message}\n`); }
  }
  return lines.join('\n') || 'No WiFi interfaces found.';
}

async function routeros_vlan_status({ router }) {
  const conn = getConn(router);
  const lines = [];
  const [vR, bvR] = await Promise.allSettled([
    rosGet(conn, '/interface/vlan'),
    rosGet(conn, '/interface/bridge/vlan'),
  ]);
  if (vR.status === 'fulfilled') {
    const list = Array.isArray(vR.value) ? vR.value : [];
    lines.push(`VLAN interfaces: ${list.length}`);
    list.forEach(v => lines.push(
      `  id=${v['vlan-id']}  name=${v.name}  on=${v.interface}  ${v.running === 'true' ? '● up' : '○ down'}`
    ));
  }
  if (bvR.status === 'fulfilled') {
    const list = Array.isArray(bvR.value) ? bvR.value : [];
    if (list.length) {
      lines.push(`\nBridge VLANs: ${list.length}`);
      list.forEach(v => lines.push(
        `  vids=${v['vlan-ids']}  bridge=${v.bridge}  tagged=${v.tagged || '—'}  untagged=${v.untagged || '—'}`
      ));
    }
  }
  return lines.join('\n') || 'No VLANs configured.';
}

async function routeros_list_routes({ router }) {
  const conn = getConn(router);
  const res  = await rosGet(conn, '/ip/route?active=true');
  const list = Array.isArray(res) ? res : [];
  return table(list.map(r => ({
    Destination: r['dst-address'] || '',
    Gateway:     r.gateway || '—',
    Interface:   r.interface || '—',
    Distance:    r.distance || 0,
  })));
}

async function routeros_route_analysis({ router }) {
  const conn = getConn(router);
  const res  = await rosGet(conn, '/ip/route');
  const list = Array.isArray(res) ? res : [];
  const active = list.filter(r => r.active === 'true' || r.active === true);
  const def    = active.find(r => r['dst-address'] === '0.0.0.0/0');
  const gws    = [...new Set(active.map(r => r.gateway).filter(Boolean))];
  return [
    `Total routes  : ${list.length}`,
    `Active        : ${active.length}`,
    `Inactive      : ${list.length - active.length}`,
    `Gateways      : ${gws.join(', ') || '—'}`,
    `Default route : ${def ? `via ${def.gateway}  (distance=${def.distance})` : 'not found ⚠'}`,
  ].join('\n');
}

async function routeros_log_search({ query, topics, limit, router }) {
  const conn = getConn(router);
  let url = '/log';
  if (topics) url += '?topics=' + encodeURIComponent(topics);
  const res  = await rosGet(conn, url);
  let list   = Array.isArray(res) ? res : [];
  if (query) { const q = query.toLowerCase(); list = list.filter(e => (e.message || '').toLowerCase().includes(q)); }
  list = list.slice(-(parseInt(limit) || 50));
  if (!list.length) return 'No entries found.';
  return list.map(e => `${e.time || ''}  [${(e.topics || '').padEnd(20)}]  ${e.message || ''}`).join('\n');
}

async function routeros_log_stats({ router }) {
  const conn = getConn(router);
  const res  = await rosGet(conn, '/log');
  const list = Array.isArray(res) ? res : [];
  const byTopic = {};
  list.forEach(e => { const t = e.topics || 'other'; byTopic[t] = (byTopic[t] || 0) + 1; });
  const sorted = Object.entries(byTopic).sort((a, b) => b[1] - a[1]);
  return [`Total entries: ${list.length}\n`, 'By topic:', ...sorted.map(([t, n]) => `  ${t.padEnd(30)} ${n}`)].join('\n');
}

async function routeros_monitor_logs({ topics, duration, router }) {
  const conn = getConn(router);
  const secs = Math.min(parseInt(duration) || 10, 60);
  const url  = '/log' + (topics ? '?topics=' + encodeURIComponent(topics) : '');
  const initial = await rosGet(conn, url);
  const before = new Set((Array.isArray(initial) ? initial : []).map(e => e['.id']));
  await sleep(secs * 1000);
  const afterRes = await rosGet(conn, url);
  const after = Array.isArray(afterRes) ? afterRes : [];
  const newEntries = after.filter(e => !before.has(e['.id']));
  if (!newEntries.length) return `No new log entries in ${secs}s.`;
  return newEntries.map(e => `${e.time || ''}  [${(e.topics || '').padEnd(20)}]  ${e.message || ''}`).join('\n');
}

async function routeros_list_users({ router }) {
  const conn = getConn(router);
  const res  = await rosGet(conn, '/user');
  const list = Array.isArray(res) ? res : [];
  return table(list.map(u => ({
    Name: u.name, Group: u.group || '—', Address: u.address || '0.0.0.0/0',
    'Last login': u['last-logged-in'] || '—',
  })));
}

async function routeros_active_sessions({ router }) {
  const conn = getConn(router);
  const res  = await rosGet(conn, '/user/active');
  const list = Array.isArray(res) ? res : [];
  if (!list.length) return 'No active sessions.';
  return table(list.map(s => ({ User: s.name, Via: s.via || '—', Address: s.address || '—', When: s.when || '—' })));
}

async function routeros_firmware_status({ router }) {
  const conn = getConn(router);
  const [rRes, rbRes] = await Promise.allSettled([
    rosGet(conn, '/system/resource'),
    rosGet(conn, '/system/routerboard'),
  ]);
  const lines = [];
  if (rRes.status === 'fulfilled') {
    const r = Array.isArray(rRes.value) ? rRes.value[0] : rRes.value;
    lines.push(`RouterOS   : ${r.version}`);
    lines.push(`Platform   : ${r.architecture}  ${r['board-name'] || ''}`);
  }
  if (rbRes.status === 'fulfilled') {
    const r = Array.isArray(rbRes.value) ? rbRes.value[0] : rbRes.value;
    lines.push(`Firmware   : ${r['current-firmware'] || '—'}`);
    lines.push(`Upgrade to : ${r['upgrade-firmware'] || '—'}`);
    if (r['current-firmware'] && r['upgrade-firmware'] && r['current-firmware'] !== r['upgrade-firmware'])
      lines.push('⚠ Firmware upgrade available — use routeros_upgrade');
    else if (r['current-firmware'])
      lines.push('✓ Firmware up to date');
  }
  return lines.join('\n');
}

async function routeros_check_updates({ router }) {
  const conn = getConn(router);
  try {
    await rosPost(conn, '/system/package/update/check-for-updates', {});
    await sleep(3000);
    const res = await rosGet(conn, '/system/package/update');
    const r   = Array.isArray(res) ? res[0] : res;
    return [
      `Channel   : ${r.channel || '—'}`,
      `Installed : ${r['installed-version'] || '—'}`,
      `Latest    : ${r['latest-version'] || '—'}`,
      `Status    : ${r.status || '—'}`,
    ].join('\n');
  } catch(e) {
    return `Could not check updates: ${e.message}`;
  }
}

async function routeros_upgrade({ router, confirm, dry_run }) {
  const preview = previewDestructive({ action: 'upgrade', dry_run, confirm, preview: 'upgrade would be initiated and router may reboot' });
  if (preview) return preview;
  const conn = getConn(router);
  await rosPost(conn, '/system/package/update/install', {});
  return '✓ Upgrade initiated. Router will reboot to apply updates.';
}

async function routeros_file_list({ router }) {
  const conn = getConn(router);
  const res  = await rosGet(conn, '/file');
  const list = Array.isArray(res) ? res : [];
  return table(list.map(f => ({
    Name: f.name, Type: f.type || '—', Size: fmtBytes(f.size || 0), Date: f['creation-time'] || '—',
  })));
}

async function routeros_discover_network({ router }) {
  const conn = getConn(router);
  const lines = [];
  const [nbR, arpR] = await Promise.allSettled([
    rosGet(conn, '/ip/neighbor'),
    rosGet(conn, '/ip/arp'),
  ]);
  if (nbR.status === 'fulfilled') {
    const list = Array.isArray(nbR.value) ? nbR.value : [];
    lines.push(`Neighbors (LLDP/CDP/MNDP): ${list.length}`);
    list.forEach(n => lines.push(
      `  ${(n.identity || n.address || '—').padEnd(22)}  ip=${n.address || '—'}  iface=${n.interface || '—'}  platform=${n.platform || '—'}`
    ));
  }
  if (arpR.status === 'fulfilled') {
    const list = Array.isArray(arpR.value) ? arpR.value : [];
    lines.push(`\nARP table: ${list.length}`);
    list.slice(0, 30).forEach(a => lines.push(
      `  ${(a.address || '').padEnd(16)}  ${(a['mac-address'] || '').padEnd(18)}  ${a.interface || '—'}`
    ));
    if (list.length > 30) lines.push(`  ...${list.length - 30} more`);
  }
  return lines.join('\n');
}

async function routeros_drift_check({ router }) {
  const conn = getConn(router);
  const res  = await rosGet(conn, '/system/clock');
  const r    = Array.isArray(res) ? res[0] : res;
  const localTs = Math.floor(Date.now() / 1000);
  return [
    `Router date : ${r.date || '—'}`,
    `Router time : ${r.time || '—'}`,
    `Local time  : ${new Date().toISOString()}`,
    `NTP server  : ${r['ntp-server'] || '—'}`,
  ].join('\n');
}

async function routeros_audit_log({ router }) {
  const conn = getConn(router);
  const res  = await rosGet(conn, '/log?topics=system,account,critical');
  const list = Array.isArray(res) ? res : [];
  const audit = list.filter(e => {
    const t = (e.topics || '').toLowerCase();
    return t.includes('account') || t.includes('critical') || (e.message || '').includes('login');
  }).slice(-30);
  if (!audit.length) return 'No audit events found.';
  return audit.map(e => `${e.time || ''}  [${e.topics || ''}]  ${e.message || ''}`).join('\n');
}

async function routeros_add_alert({ name, condition, message, router }) {
  // Alerts are stored locally (no RouterOS native alert API)
  const store = global.__alerts || (global.__alerts = []);
  store.push({ name, condition, message, created: new Date().toISOString() });
  return `✓ Alert "${name}" added. (${store.length} total alerts)`;
}

function routeros_list_alerts() {
  const store = global.__alerts || [];
  if (!store.length) return 'No alerts configured.';
  return store.map((a, i) => `${i + 1}. [${a.name}]  condition=${a.condition}  msg=${a.message}  created=${a.created}`).join('\n');
}

async function routeros_generate_report({ router }) {
  const sections = [];
  sections.push('# MikroTik Diagnostic Report');
  sections.push(`*Generated at: ${new Date().toISOString()}*\n`);
  
  sections.push('## 1. System Info');
  try { sections.push(await routeros_system_info({ router }) + '\n'); } catch(e) { sections.push(`Error: ${e.message}\n`); }
  
  sections.push('## 2. Health & Resources');
  try { sections.push(await routeros_health_check({ router }) + '\n'); } catch(e) { sections.push(`Error: ${e.message}\n`); }
  
  sections.push('## 3. Security Audit');
  try { sections.push(await routeros_security_audit({ router }) + '\n'); } catch(e) { sections.push(`Error: ${e.message}\n`); }

  sections.push('## 4. VPN Status');
  try { sections.push(await routeros_vpn_status({ router }) + '\n'); } catch(e) { sections.push(`Error: ${e.message}\n`); }

  return sections.join('\n');
}

async function routeros_apply_template({ template, params, router, confirm, dry_run }) {
  const conn = getConn(router);
  const p = params || {};
  const templates = {
    firewall_baseline: async () => {
      const rules = [
        { chain: 'input', action: 'accept', connection_state: 'established,related' },
        { chain: 'input', action: 'accept', 'in-interface': p.wan || 'ether1', protocol: 'icmp' },
        { chain: 'input', action: 'drop',   'in-interface': p.wan || 'ether1' },
        { chain: 'forward', action: 'accept', connection_state: 'established,related' },
        { chain: 'forward', action: 'drop',   connection_state: 'invalid' },
      ];
      const existingRes = await rosGet(conn, '/ip/firewall/filter');
      const existing = Array.isArray(existingRes) ? existingRes : [];
      let added = 0, already = 0;
      for (const r of rules) {
        const found = existing.find(e =>
          (e.chain || '') === (r.chain || '') &&
          (e.action || '') === (r.action || '') &&
          (e['in-interface'] || '') === (r['in-interface'] || '') &&
          (e.connection_state || '') === (r.connection_state || '') &&
          (e.protocol || '') === (r.protocol || '')
        );
        if (found) { already++; continue; }
        if (dry_run === true || confirm !== true) continue;
        await rosPut(conn, '/ip/firewall/filter', r);
        added++;
      }
      const wouldAdd = rules.length - already;
      if (dry_run === true || confirm !== true) {
        return previewDestructive({
          action: 'apply template firewall_baseline',
          dry_run,
          confirm,
          preview: `firewall_baseline already exists=${already}, would add=${wouldAdd}`,
        });
      }
      return `✓ Applied firewall_baseline (added=${added}, already exists=${already})`;
    },
    wireguard_peer: async () => {
      const iface = p.interface || 'wg0';
      const peer = {
        interface: iface,
        'allowed-address': p.allowed_address || '10.0.0.2/32',
        'public-key': p.public_key || '',
      };
      const existingRes = await rosGet(conn, '/interface/wireguard/peers');
      const existing = Array.isArray(existingRes) ? existingRes : [];
      const found = existing.find(e =>
        (e.interface || '') === peer.interface &&
        (e['allowed-address'] || '') === peer['allowed-address'] &&
        (e['public-key'] || '') === peer['public-key']
      );
      if (found) return 'wireguard_peer: already exists';
      if (dry_run === true || confirm !== true) {
        return previewDestructive({
          action: 'apply template wireguard_peer',
          dry_run,
          confirm,
          preview: `wireguard_peer would add on ${iface}`,
        });
      }
      await rosPut(conn, '/interface/wireguard/peers', peer);
      return `wireguard_peer: added to ${iface}`;
    },
    dhcp_server: async () => {
      const poolName = p.pool_name || 'dhcp-pool';
      const serverName = p.server_name || 'dhcp1';
      const poolRes = await rosGet(conn, '/ip/pool');
      const srvRes = await rosGet(conn, '/ip/dhcp-server');
      const pools = Array.isArray(poolRes) ? poolRes : [];
      const servers = Array.isArray(srvRes) ? srvRes : [];
      const poolExists = pools.some(x => x.name === poolName);
      const srvExists = servers.some(x => x.name === serverName);
      if (dry_run === true || confirm !== true) {
        return previewDestructive({
          action: 'apply template dhcp_server',
          dry_run,
          confirm,
          preview: `dhcp_server pool(${poolName}) ${poolExists ? 'already exists' : 'would add'}, server(${serverName}) ${srvExists ? 'already exists' : 'would add'}`,
        });
      }
      if (!poolExists) await rosPut(conn, '/ip/pool', { name: poolName, ranges: p.ranges || '192.168.88.10-192.168.88.254' });
      if (!srvExists) await rosPut(conn, '/ip/dhcp-server', { name: serverName, interface: p.interface || 'bridge', 'address-pool': poolName, disabled: 'no' });
      return `dhcp_server: added=${Number(!poolExists) + Number(!srvExists)}, already exists=${Number(poolExists) + Number(srvExists)}`;
    },
  };
  if (!templates[template]) return `Unknown template: ${template}. Available: ${Object.keys(templates).join(', ')}`;
  return templates[template]();
}

function routeros_list_templates() {
  return [
    'firewall_baseline  — Basic input/forward filter rules (params: wan). Idempotency: key fields only (chain/action/in-interface/connection_state/protocol).',
    'wireguard_peer     — Add WireGuard peer (params: interface, allowed_address, public_key)',
    'dhcp_server        — DHCP server + pool (params: interface, ranges, pool_name, server_name). Idempotency: by names.',
  ].join('\n');
}

async function routeros_watch({ path, interval, count, router }) {
  const conn = getConn(router);
  const ms   = (parseInt(interval) || 2) * 1000;
  const n    = Math.min(parseInt(count) || 5, 20);
  const out  = [];
  for (let i = 0; i < n; i++) {
    const res  = await rosGet(conn, path);
    const list = Array.isArray(res) ? res : [res];
    out.push(`=== poll ${i + 1}/${n}  ${new Date().toLocaleTimeString()} ===`);
    out.push(list.slice(0, 5).map(r => JSON.stringify(r)).join('\n'));
    if (i < n - 1) await sleep(ms);
  }
  return out.join('\n');
}

function routeros_open_ui({ page, router }) {
  const url = buildUiUrl({
    page,
    sslEnabled: !!(process.env.SSL_KEY && process.env.SSL_CERT),
    host: process.env.HOST || '127.0.0.1',
    port: process.env.PORT || 8080,
  });
  exec(process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`);
  return `✓ Opening ${url}`;
}

// ── Tool dispatch table ───────────────────────────────────────────────────────
const TOOLS = {
  routeros_connect, routeros_disconnect, routeros_list_connections,
  routeros_system_info, routeros_health_check,
  routeros_list, routeros_get, routeros_set, routeros_add, routeros_remove,
  routeros_enable, routeros_disable, routeros_bulk, routeros_export, routeros_backup,
  routeros_ping, routeros_traceroute, routeros_monitor_traffic, routeros_top_talkers,
  routeros_firewall_analyze, routeros_firewall_move,
  routeros_security_audit, routeros_dhcp_report, routeros_pool_status,
  routeros_dns_status, routeros_dns_static_list, routeros_dns_static_add,
  routeros_dns_static_remove, routeros_dns_cache_flush,
  routeros_vpn_status, routeros_wireguard_client_config,
  routeros_wifi_status, routeros_vlan_status,
  routeros_list_routes, routeros_route_analysis,
  routeros_log_search, routeros_log_stats, routeros_monitor_logs,
  routeros_list_users, routeros_active_sessions,
  routeros_firmware_status, routeros_check_updates, routeros_upgrade,
  routeros_file_list, routeros_discover_network,
  routeros_drift_check, routeros_audit_log,
  routeros_add_alert, routeros_list_alerts, routeros_generate_report,
  routeros_apply_template, routeros_list_templates, routeros_watch,
  routeros_open_ui,
};

// ── Tool definitions for tools/list ──────────────────────────────────────────
function str(desc)           { return { type: 'string',  description: desc }; }
function num(desc)           { return { type: 'number',  description: desc }; }
function boo(desc)           { return { type: 'boolean', description: desc }; }
function obj(desc, props)    { return { type: 'object',  description: desc, properties: props }; }
const router_p = { router: str('Router alias (optional, uses default connection)') };

const TOOL_DEFS = [
  { name: 'routeros_connect',
    description: 'Connect to a MikroTik router via RouterOS REST API. Username is always "MCP-User".',
    inputSchema: { type: 'object', required: ['address', 'password'],
      properties: { address: str('Router IP or hostname'), password: str('Password for MCP-User'),
                    alias: str('Friendly name (optional)'), use_tls: boo('Use HTTPS (default: try TLS, fallback to HTTP)') } } },
  { name: 'routeros_disconnect',
    description: 'Disconnect from a router.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_list_connections',
    description: 'List all active router connections.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'routeros_system_info',
    description: 'Get system info: identity, board, version, uptime, CPU, memory, storage.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_health_check',
    description: 'Health check: CPU, memory, disk, temperature thresholds.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_list',
    description: 'Generic list of any RouterOS resource (e.g. /ip/address, /interface, /ip/firewall/filter).',
    inputSchema: { type: 'object', required: ['path'],
      properties: { path: str('REST path, e.g. /ip/address'), props: str('Comma-separated fields'),
                    query: str('URL query string filter'), ...router_p } } },
  { name: 'routeros_get',
    description: 'Get a single RouterOS item by ID.',
    inputSchema: { type: 'object', required: ['path', 'id'],
      properties: { path: str('REST path'), id: str('Item .id or name'), ...router_p } } },
  { name: 'routeros_set',
    description: 'Update an existing RouterOS item (requires confirm=true unless dry_run=true).',
    inputSchema: { type: 'object', required: ['path', 'id', 'values'],
      properties: { path: str('REST path'), id: str('Item .id'),
                    values: obj('Fields to update', {}),
                    confirm: boo('Apply change only when true'),
                    dry_run: boo('Preview only, does not apply changes'),
                    ...router_p } } },
  { name: 'routeros_add',
    description: 'Add a new RouterOS item.',
    inputSchema: { type: 'object', required: ['path', 'values'],
      properties: { path: str('REST path'), values: obj('Item fields', {}), ...router_p } } },
  { name: 'routeros_remove',
    description: 'Remove a RouterOS item (requires confirm=true unless dry_run=true).',
    inputSchema: { type: 'object', required: ['path', 'id'],
      properties: { path: str('REST path'), id: str('Item .id'),
        confirm: boo('Apply change only when true'),
        dry_run: boo('Preview only, does not apply changes'),
        ...router_p } } },
  { name: 'routeros_enable',
    description: 'Enable a disabled RouterOS item.',
    inputSchema: { type: 'object', required: ['path', 'id'],
      properties: { path: str('REST path'), id: str('Item .id'), ...router_p } } },
  { name: 'routeros_disable',
    description: 'Disable a RouterOS item.',
    inputSchema: { type: 'object', required: ['path', 'id'],
      properties: { path: str('REST path'), id: str('Item .id'), ...router_p } } },
  { name: 'routeros_bulk',
    description: 'Execute multiple REST operations in sequence. Destructive methods require confirm=true unless dry_run=true.',
    inputSchema: { type: 'object', required: ['operations'],
      properties: { operations: { type: 'array', description: 'Array of {method, path, body}',
        items: obj('Operation', { method: str('GET/POST/PATCH/PUT/DELETE'), path: str('REST path'), body: obj('Request body', {}) }) },
      confirm: boo('Apply destructive operations only when true'),
      dry_run: boo('Preview destructive operations only'),
      ...router_p } } },
  { name: 'routeros_export',
    description: 'Export router configuration as JSON. Optionally limit to a specific path.',
    inputSchema: { type: 'object', properties: { path: str('REST path to export (optional)'), ...router_p } } },
  { name: 'routeros_backup',
    description: 'Save a configuration backup on the router.',
    inputSchema: { type: 'object', properties: { name: str('Backup filename (default: backup-YYYY-MM-DD)'), ...router_p } } },
  { name: 'routeros_ping',
    description: 'Ping a host from the router.',
    inputSchema: { type: 'object', required: ['address'],
      properties: { address: str('IP or hostname to ping'), count: num('Packet count (default 4)'), ...router_p } } },
  { name: 'routeros_traceroute',
    description: 'Traceroute from the router to a destination.',
    inputSchema: { type: 'object', required: ['address'],
      properties: { address: str('Destination IP or hostname'), ...router_p } } },
  { name: 'routeros_monitor_traffic',
    description: 'Monitor real-time RX/TX rates on an interface for N seconds.',
    inputSchema: { type: 'object', required: ['interface'],
      properties: { interface: str('Interface name, e.g. ether1'), duration: num('Seconds to monitor (default 5, max 30)'), ...router_p } } },
  { name: 'routeros_top_talkers',
    description: 'List interfaces sorted by total traffic volume.',
    inputSchema: { type: 'object', properties: { limit: num('Number of interfaces (default 10)'), ...router_p } } },
  { name: 'routeros_firewall_analyze',
    description: 'Analyze firewall rules: filter, NAT, mangle chains and port forwards.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_firewall_move',
    description: 'Move a firewall rule to a different position.',
    inputSchema: { type: 'object', required: ['path', 'id', 'destination'],
      properties: { path: str('Chain path, e.g. /ip/firewall/filter'), id: str('Rule .id'),
                    destination: num('Target position'), ...router_p } } },
  { name: 'routeros_security_audit',
    description: 'Security audit: check services, users, firewall, known vulnerabilities. Returns score 0–100.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_dhcp_report',
    description: 'DHCP servers status and full list of leases.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_pool_status',
    description: 'IP pool utilization summary.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_dns_status',
    description: 'DNS server configuration and cache statistics.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_dns_static_list',
    description: 'List static DNS entries.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_dns_static_add',
    description: 'Add a static DNS entry.',
    inputSchema: { type: 'object', required: ['name', 'address'],
      properties: { name: str('Hostname'), address: str('IP address'), ttl: str('TTL (optional)'), ...router_p } } },
  { name: 'routeros_dns_static_remove',
    description: 'Remove a static DNS entry.',
    inputSchema: { type: 'object', required: ['id'],
      properties: { id: str('Entry .id'), ...router_p } } },
  { name: 'routeros_dns_cache_flush',
    description: 'Flush the DNS cache.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_vpn_status',
    description: 'WireGuard interfaces and peers status with handshake times and traffic.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_wireguard_client_config',
    description: 'Generate WireGuard client config file for a peer.',
    inputSchema: { type: 'object',
      properties: { peer_id: str('Peer .id or allowed-address (optional, uses first peer)'), ...router_p } } },
  { name: 'routeros_wifi_status',
    description: 'WiFi interfaces and connected clients.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_vlan_status',
    description: 'VLAN interfaces and bridge VLAN table.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_list_routes',
    description: 'List active routing table entries.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_route_analysis',
    description: 'Routing table summary: default route, gateways, active vs inactive counts.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_log_search',
    description: 'Search system log entries by text and/or topic.',
    inputSchema: { type: 'object',
      properties: { query: str('Text to search'), topics: str('Topic filter, e.g. firewall,dhcp'),
                    limit: num('Max entries (default 50)'), ...router_p } } },
  { name: 'routeros_log_stats',
    description: 'Log entry counts grouped by topic.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_monitor_logs',
    description: 'Watch for new log entries for N seconds.',
    inputSchema: { type: 'object',
      properties: { topics: str('Topic filter (optional)'), duration: num('Seconds to watch (default 10, max 60)'), ...router_p } } },
  { name: 'routeros_list_users',
    description: 'List RouterOS users with groups and last login.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_active_sessions',
    description: 'List currently active management sessions.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_firmware_status',
    description: 'Current RouterOS and firmware versions, upgrade availability.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_check_updates',
    description: 'Check for available RouterOS package updates.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_upgrade',
    description: 'Install RouterOS updates (triggers reboot; requires confirm=true unless dry_run=true).',
    inputSchema: { type: 'object', properties: {
      confirm: boo('Apply upgrade only when true'),
      dry_run: boo('Preview only, does not apply changes'),
      ...router_p } } },
  { name: 'routeros_file_list',
    description: 'List files on the router storage.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_discover_network',
    description: 'Discover network neighbors (LLDP/CDP/MNDP) and ARP table.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_drift_check',
    description: 'Check router clock vs local time for NTP drift.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_audit_log',
    description: 'Show security-relevant log entries: logins, account changes, critical events.',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_add_alert',
    description: 'Register an alert condition (stored in memory for this session).',
    inputSchema: { type: 'object', required: ['name', 'condition', 'message'],
      properties: { name: str('Alert name'), condition: str('Condition description'), message: str('Alert message'), ...router_p } } },
  { name: 'routeros_list_alerts',
    description: 'List registered alerts.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'routeros_generate_report',
    description: 'Generate a comprehensive Markdown system report (system, health, security, VPN).',
    inputSchema: { type: 'object', properties: { ...router_p } } },
  { name: 'routeros_apply_template',
    description: 'Apply a configuration template idempotently by key fields (requires confirm=true unless dry_run=true). Use routeros_list_templates to see comparison details.',
    inputSchema: { type: 'object', required: ['template'],
      properties: { template: str('Template name'),
        params: obj('Template parameters', {}),
        confirm: boo('Apply change only when true'),
        dry_run: boo('Preview only, does not apply changes'),
        ...router_p } } },
  { name: 'routeros_list_templates',
    description: 'List available configuration templates.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'routeros_watch',
    description: 'Poll a REST path repeatedly and return snapshots.',
    inputSchema: { type: 'object', required: ['path'],
      properties: { path: str('REST path to watch'), interval: num('Seconds between polls (default 2)'),
                    count: num('Number of polls (default 5, max 20)'), ...router_p } } },
  { name: 'routeros_open_ui',
    description: 'Open the MikroTik web dashboard in the browser.',
    inputSchema: { type: 'object',
      properties: { page: str('Page: dashboard|interfaces|traffic|dhcp|vpn|routes|health|settings'), ...router_p } } },
];

// ── MCP JSON-RPC protocol ─────────────────────────────────────────────────────
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function err(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === 'notifications/initialized') return; // no response needed

  if (method === 'tools/list') {
    return ok(id, { tools: TOOL_DEFS });
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    const fn = TOOLS[name];
    if (!fn) return err(id, -32601, `Unknown tool: ${name}`);
    try {
      const text = await fn(args || {});
      return ok(id, { content: [{ type: 'text', text: String(text ?? '') }] });
    } catch(e) {
      return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }

  if (method === 'ping') return ok(id, {});

  return err(id, -32601, `Method not found: ${method}`);
}

// ── Stdio transport ───────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', line => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); }
  catch(e) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  handle(msg).catch(e => {
    process.stderr.write(`[mcp-server] unhandled: ${e.message}\n`);
  });
});

process.stderr.write(`[mikrotik-mcp] v${SERVER_INFO.version} ready\n`);
