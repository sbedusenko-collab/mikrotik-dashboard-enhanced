#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const { escapeHtml } = require('./utils');
const { previewDestructive } = require('./routeros-tools-security');
const { buildUiUrl } = require('./routeros-tools-mcp');
const { loadEnvOnce } = require('./config');

let passed = 0;
let failed = 0;

function assertEq(a, b, msg) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assert(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`✗ ${msg}`);
}

const escaped = escapeHtml(`<script>alert("x")</script> & 'x'`);
assertEq(escaped, '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;x&#39;', 'escapeHtml escapes HTML');

const preview = previewDestructive({ action: 'remove', confirm: false, dry_run: false, preview: 'would remove /ip/firewall/filter/*1' });
assert(preview.includes('Preview:'), 'previewDestructive returns preview text');
assertEq(previewDestructive({ action: 'remove', confirm: true, dry_run: false, preview: 'noop' }), null, 'previewDestructive allows confirmed action');

assertEq(buildUiUrl({ page: 'dashboard', host: '127.0.0.1', port: 8080, sslEnabled: false }), 'http://127.0.0.1:8080', 'buildUiUrl dashboard');
assertEq(buildUiUrl({ page: 'logs', host: 'router.local', port: 8443, sslEnabled: true }), 'https://router.local:8443#logs', 'buildUiUrl hash page');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikro-env-'));
fs.writeFileSync(path.join(tmpDir, '.env'), [
  'TEST_ENV_KEY=ok-value',
  'TEST_ENV_QUOTED="value with # hash and spaces"',
  'TEST_ENV_COMMENT=abc # trailing comment',
].join('\n') + '\n');
delete process.env.TEST_ENV_KEY;
delete process.env.TEST_ENV_QUOTED;
delete process.env.TEST_ENV_COMMENT;
loadEnvOnce(tmpDir);
assertEq(process.env.TEST_ENV_KEY, 'ok-value', 'loadEnvOnce reads .env');
assertEq(process.env.TEST_ENV_QUOTED, 'value with # hash and spaces', 'loadEnvOnce reads quoted values');
assertEq(process.env.TEST_ENV_COMMENT, 'abc', 'loadEnvOnce strips inline comment for unquoted values');

const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
assert(serverJs.includes("'/api/system'"), 'server route map includes /api/system');
assert(serverJs.includes("'/api/health-summary'"), 'server route map includes /api/health-summary');
assert(serverJs.includes('withShortCache('), 'server uses short cache helper');

const appJs = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
const start = appJs.indexOf('function generateMarkdownReport(data) {');
const end = appJs.indexOf('\n\nasync function fetchReport()', start);
assert(start !== -1 && end !== -1, 'generateMarkdownReport source exists');
if (start !== -1 && end !== -1) {
  const fnSrc = appJs.slice(start, end);
  const sandbox = { fmtMB: x => `${x}`, window: { fmtBytes: x => `${x}` } };
  vm.createContext(sandbox);
  vm.runInContext(`${fnSrc}; this._fn = generateMarkdownReport;`, sandbox);
  const text = sandbox._fn({ sys: {}, ifaces: [], dhcp: [], vpn: [], timestamp: 'now' });
  assert(typeof text === 'string' && text.includes('MikroTik Diagnostic Report'), 'generateMarkdownReport smoke');
}

console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
