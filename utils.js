// ── Shared Utilities ──────────────────────────────────────────────────────────

function fmtBytes(b) {
  b = parseInt(b) || 0;
  if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b > 1e6) return (b / 1e6).toFixed(2) + ' MB';
  if (b > 1e3) return (b / 1e3).toFixed(1) + ' KB';
  return b + ' B';
}

function fmtMB(b) {
  return (b / 1048576).toFixed(0) + ' MB';
}

function fmtRate(b) {
  b = parseFloat(b) || 0;
  if (b < 1e3) return b.toFixed(0) + ' B/s';
  if (b < 1e6) return (b / 1e3).toFixed(1) + ' KB/s';
  if (b < 1e9) return (b / 1e6).toFixed(2) + ' MB/s';
  return (b / 1e9).toFixed(2) + ' GB/s';
}

// Export for Node.js (CommonJS) if available, otherwise just pollutes window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fmtBytes, fmtMB, fmtRate };
}
