function buildUiUrl({ page, host, port, sslEnabled }) {
  const p = page || 'dashboard';
  const hash = p === 'dashboard' ? '' : `#${p}`;
  const protocol = sslEnabled ? 'https' : 'http';
  return `${protocol}://${host}:${port}${hash}`;
}

module.exports = { buildUiUrl };
