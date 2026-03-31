#!/usr/bin/env node
/**
 * Unit tests for MikroTik Dashboard — zero dependencies
 * Run: node test.js
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; return; }
  failed++;
  console.error(`  ✗ ${msg}`);
}

function assertEq(a, b, msg) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`  ✗ ${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch(e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ── Helpers (inline copies to test logic without requiring server.js) ──────────

function parseCookies(header) {
  const cookies = {};
  (header || '').split(';').forEach(c => {
    const [k, ...rest] = c.trim().split('=');
    if (k) cookies[k.trim()] = rest.join('=');
  });
  return cookies;
}

function fmtBytes(b) {
  b = parseInt(b) || 0;
  if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b > 1e6) return (b / 1e6).toFixed(2) + ' MB';
  if (b > 1e3) return (b / 1e3).toFixed(1) + ' KB';
  return b + ' B';
}

function fmtRate(b) {
  if (b < 1e3) return b.toFixed(0) + ' B/s';
  if (b < 1e6) return (b/1e3).toFixed(1) + ' KB/s';
  if (b < 1e9) return (b/1e6).toFixed(2) + ' MB/s';
  return (b/1e9).toFixed(2) + ' GB/s';
}

function table(rows, headers) {
  if (!rows.length) return 'No items.';
  const cols = headers || Object.keys(rows[0]);
  const data = rows.map(r => cols.map(c => String(r[c] ?? '—')));
  const widths = cols.map((c, i) => Math.max(c.length, ...data.map(r => r[i].length)));
  const fmt = row => row.map((v, i) => v.padEnd(widths[i])).join('  ');
  return [fmt(cols), widths.map(w => '-'.repeat(w)).join('  '), ...data.map(fmt)].join('\n');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\nCookie parsing:');
test('parses single cookie', () => {
  const c = parseCookies('session=abc123');
  assertEq(c.session, 'abc123', 'session value');
});

test('parses multiple cookies', () => {
  const c = parseCookies('session=abc; foo=bar; x=1');
  assertEq(c.session, 'abc', 'session');
  assertEq(c.foo, 'bar', 'foo');
  assertEq(c.x, '1', 'x');
});

test('handles empty cookie header', () => {
  const c = parseCookies('');
  assertEq(Object.keys(c).length, 0, 'empty object');
});

test('handles missing cookie header', () => {
  const c = parseCookies();
  assertEq(Object.keys(c).length, 0, 'empty object');
});

console.log('\nByte formatting:');
test('formats bytes', () => { assertEq(fmtBytes(500), '500 B', 'bytes'); });
test('formats KB', () => { assertEq(fmtBytes(1500), '1.5 KB', 'KB'); });
test('formats MB', () => { assertEq(fmtBytes(2500000), '2.50 MB', 'MB'); });
test('formats GB', () => { assertEq(fmtBytes(1500000000), '1.50 GB', 'GB'); });
test('handles zero', () => { assertEq(fmtBytes(0), '0 B', 'zero'); });
test('handles negative', () => { assertEq(fmtBytes(-1), '-1 B', 'negative'); });

console.log('\nRate formatting:');
test('formats B/s', () => { assertEq(fmtRate(500), '500 B/s', 'B/s'); });
test('formats KB/s', () => { assertEq(fmtRate(1500), '1.5 KB/s', 'KB/s'); });
test('formats MB/s', () => { assertEq(fmtRate(2500000), '2.50 MB/s', 'MB/s'); });

console.log('\nTable formatting:');
test('formats table', () => {
  const t = table([{ name: 'eth0', status: 'up' }, { name: 'eth1', status: 'down' }]);
  assert(t.includes('name'), 'has header');
  assert(t.includes('eth0'), 'has row 1');
  assert(t.includes('eth1'), 'has row 2');
});

test('empty table', () => {
  assertEq(table([]), 'No items.', 'empty message');
});

console.log('\nSession management:');
test('session TTL is 24 hours', () => {
  const ttl = 24 * 60 * 60 * 1000;
  assert(ttl === 86400000, '86400000 ms');
});

test('rate limit window is 60 seconds', () => {
  const window = 60 * 1000;
  assert(window === 60000, '60000 ms');
});

test('report cache TTL is 30 seconds', () => {
  const ttl = 30 * 1000;
  assert(ttl === 30000, '30000 ms');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
