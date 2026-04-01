const http = require('http');

function req(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:8080${path}`, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function run() {
  let passed = 0, failed = 0;

  // Test 1: Static file
  const r1 = await req('/');
  if (r1.status === 200 && r1.body.includes('MikroTik Dashboard')) { passed++; console.log('✓ Static file serving'); }
  else { failed++; console.log('✗ Static file serving'); }

  // Test 2: SPA fallback
  const r2 = await req('/some/unknown/route');
  if (r2.status === 200 && r2.body.includes('MikroTik Dashboard')) { passed++; console.log('✓ SPA fallback'); }
  else { failed++; console.log('✗ SPA fallback'); }

  // Test 3: Security headers
  const r3 = await req('/');
  const hasHeaders = r3.headers['x-content-type-options'] === 'nosniff' &&
                     r3.headers['x-frame-options'] === 'DENY' &&
                     r3.headers['x-xss-protection'] === '1; mode=block';
  if (hasHeaders) { passed++; console.log('✓ Security headers'); }
  else { failed++; console.log('✗ Security headers'); }

  // Test 4: API error response (no router)
  const r4 = await req('/api/system');
  if (r4.status === 503 && r4.body.includes('error')) { passed++; console.log('✓ API error response'); }
  else { failed++; console.log('✗ API error response'); }

  // Test 5: Traffic endpoint (should return empty object)
  const r5 = await req('/api/traffic');
  if (r5.status === 200 && r5.body === '{}') { passed++; console.log('✓ Traffic endpoint'); }
  else { failed++; console.log('✗ Traffic endpoint'); }

  // Test 6: Path traversal (before rate limit)
  const r6 = await req('/../windows/system.ini');
  if (r6.body.includes('MikroTik Dashboard')) { passed++; console.log('✓ Path traversal blocked (SPA fallback)'); }
  else { failed++; console.log('✗ Path traversal blocked'); }

  // Test 7: Dotfile access must be blocked
  const r7 = await req('/.env');
  if (r7.status === 403) { passed++; console.log('✓ Dotfile access blocked'); }
  else { failed++; console.log('✗ Dotfile access blocked'); }

  // Test 8: Health summary endpoint
  const r8 = await req('/api/health-summary');
  let healthOk = false;
  try {
    const payload = JSON.parse(r8.body);
    healthOk = r8.status === 200 && typeof payload.reachable === 'boolean' && typeof payload.severity === 'string';
  } catch (_) {}
  if (healthOk) { passed++; console.log('✓ Health summary endpoint'); }
  else { failed++; console.log('✗ Health summary endpoint'); }

  // Test 9: Rate limiting
  let rateLimited = false;
  const requests = [];
  for (let i = 0; i < 130; i++) {
    requests.push(req('/api/system'));
    if (i > 0 && i % 50 === 0) {
      const batch = await Promise.all(requests.splice(0, requests.length));
      for (const r of batch) { if (r.status === 429) rateLimited = true; }
      if (rateLimited) break;
    }
  }
  if (!rateLimited) {
    const batch = await Promise.all(requests);
    for (const r of batch) { if (r.status === 429) rateLimited = true; }
  }
  if (rateLimited) { passed++; console.log('✓ Rate limiting'); }
  else { failed++; console.log('✗ Rate limiting'); }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Connection error:', e.message); process.exit(1); });
