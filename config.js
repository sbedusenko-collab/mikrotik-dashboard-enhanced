const fs = require('fs');
const path = require('path');

function loadEnvOnce(dir) {
  try {
    const env = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    const parseValue = (raw) => {
      let s = String(raw || '').trim();
      if (!s) return '';
      if (s.startsWith('"') || s.startsWith("'")) {
        const q = s[0];
        let out = '';
        let i = 1;
        while (i < s.length) {
          const ch = s[i];
          if (ch === q) { i++; break; }
          if (q === '"' && ch === '\\' && i + 1 < s.length) {
            const n = s[i + 1];
            const map = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', '#': '#' };
            out += map[n] ?? n;
            i += 2;
            continue;
          }
          out += ch;
          i++;
        }
        return out;
      }
      const hashIdx = s.indexOf('#');
      if (hashIdx >= 0) s = s.slice(0, hashIdx).trimEnd();
      return s;
    };

    env.split('\n').forEach((line) => {
      const src = line.replace(/^\uFEFF/, '').trim();
      if (!src || src.startsWith('#')) return;
      const m = src.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) return;
      if (!process.env[m[1]]) process.env[m[1]] = parseValue(m[2]);
    });
  } catch (_) {}
}

module.exports = { loadEnvOnce };
