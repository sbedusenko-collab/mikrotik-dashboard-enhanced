// ── Shared Utilities ──────────────────────────────────────────────────────────

function fmtBytes(b) {
  b = Number(b) || 0;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  while (Math.abs(b) >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i === 0 ? 0 : i < 2 ? 1 : 2)} ${units[i]}`;
}

function fmtMB(b) {
  return (Number(b || 0) / 1048576).toFixed(0) + ' MiB';
}

function fmtRate(b) {
  b = Number(b) || 0;
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'];
  let i = 0;
  while (Math.abs(b) >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i === 0 ? 0 : i < 2 ? 1 : 2)} ${units[i]}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Export for Node.js (CommonJS) if available, otherwise just pollutes window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fmtBytes, fmtMB, fmtRate, escapeHtml };
}
