const fs = require('fs');
const path = require('path');

function loadEnvOnce(dir) {
  try {
    const env = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    env.split('\n').forEach(l => {
      const m = l.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  } catch (_) {}
}

module.exports = { loadEnvOnce };
