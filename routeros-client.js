const http = require('http');
const https = require('https');

function rosRequest(conn, method, path, body) {
  return new Promise((resolve, reject) => {
    const lib = conn.tls ? https : http;
    const port = Number(conn.port) || (conn.tls ? 443 : 80);
    const opts = {
      hostname: conn.address,
      port,
      path: `/rest${path}`,
      method,
      headers: {
        Authorization: conn.auth,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 10000,
      rejectUnauthorized: process.env.ALLOW_INSECURE_TLS !== '1',
    };
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = lib.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try { resolve(data ? JSON.parse(data) : null); }
        catch (_) { reject(new Error('JSON parse: ' + data.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const rosGet = (c, p) => rosRequest(c, 'GET', p, null);
const rosPost = (c, p, b) => rosRequest(c, 'POST', p, b);
const rosPatch = (c, p, b) => rosRequest(c, 'PATCH', p, b);
const rosPut = (c, p, b) => rosRequest(c, 'PUT', p, b);
const rosDelete = (c, p) => rosRequest(c, 'DELETE', p, null);

module.exports = { rosRequest, rosGet, rosPost, rosPatch, rosPut, rosDelete };
