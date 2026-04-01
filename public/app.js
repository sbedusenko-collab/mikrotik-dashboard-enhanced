// ════════════════════════════════════════════════
// Micro chart library (no dependencies)
// ════════════════════════════════════════════════
class LineChart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.opts   = Object.assign({
      bg:      '#16181f',
      gridClr: 'rgba(255,255,255,.04)',
      colors:  ['#2ecc71', '#4f7fff'],
      fills:   ['rgba(46,204,113,.08)', 'rgba(79,127,255,.08)'],
      padding: { top:8, right:4, bottom:18, left:42 },
      maxPts:  60,
      labels:  ['RX','TX'],
      fmtY:    v => v,
      tooltip: true,
    }, opts);
    this.series = opts.series || [Array(opts.maxPts||60).fill(0), Array(opts.maxPts||60).fill(0)];
    this._tip = null;
    if (opts.tooltip) this._bindTooltip();
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(canvas);
  }

  update(seriesData) {
    this.series = seriesData;
    this.draw();
  }

  draw() {
    const { canvas, ctx, opts, series } = this;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width  || canvas.parentElement?.offsetWidth || 400;
    const H = rect.height || parseInt(canvas.style.height) || canvas.height || 160;
    if (W < 10) return; // ещё не видим
    canvas.width  = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const { top, right, bottom, left } = opts.padding;
    const pw = W - left - right;
    const ph = H - top - bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, W, H);

    const allVals = series.flat().filter(v => isFinite(v));
    const maxVal  = allVals.length ? Math.max(...allVals) * 1.1 || 1 : 1;

    // Grid & Y labels
    const steps = 3;
    ctx.strokeStyle = opts.gridClr;
    ctx.lineWidth   = 1;
    ctx.fillStyle   = 'rgba(74,79,102,.7)';
    ctx.font        = `${10 * devicePixelRatio / devicePixelRatio}px -apple-system,sans-serif`;
    ctx.textAlign   = 'right';
    for (let i = 0; i <= steps; i++) {
      const y = top + ph - (ph * i / steps);
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + pw, y); ctx.stroke();
      ctx.fillText(opts.fmtY(maxVal * i / steps), left - 4, y + 3);
    }

    // Series
    series.forEach((data, si) => {
      const pts = data.slice(-opts.maxPts);
      const n   = pts.length;
      if (!n) return;

      const x = i => left + (i / (opts.maxPts - 1)) * pw;
      const y = v => top  + ph - (v / maxVal) * ph;

      // Fill
      ctx.beginPath();
      pts.forEach((v, i) => i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v)));
      ctx.lineTo(x(n-1), top + ph);
      ctx.lineTo(x(0),   top + ph);
      ctx.closePath();
      ctx.fillStyle = opts.fills[si];
      ctx.fill();

      // Line (smooth via bezier)
      ctx.beginPath();
      pts.forEach((v, i) => {
        if (i === 0) { ctx.moveTo(x(i), y(v)); return; }
        const px_ = x(i-1), py_ = y(pts[i-1]);
        const cx  = x(i);
        const cp1x = px_ + (cx - px_) * 0.5, cp1y = py_;
        const cp2x = px_ + (cx - px_) * 0.5, cp2y = y(v);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, cx, y(v));
      });
      ctx.strokeStyle = opts.colors[si];
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    });

    // Tooltip crosshair
    if (this._tip !== null) {
      const i = this._tip;
      const txX = left + (i / (opts.maxPts - 1)) * pw;
      ctx.strokeStyle = 'rgba(255,255,255,.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(txX, top); ctx.lineTo(txX, top + ph); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _bindTooltip() {
    const canvas = this.canvas;
    canvas.style.cursor = 'crosshair';
    canvas.addEventListener('mousemove', e => {
      const rect  = canvas.getBoundingClientRect();
      const { left, right } = this.opts.padding;
      const pw    = rect.width - left - right;
      const mx    = e.clientX - rect.left - left;
      const idx   = Math.round(mx / pw * (this.opts.maxPts - 1));
      this._tip   = Math.max(0, Math.min(this.opts.maxPts - 1, idx));
      this.draw();
      this._showTip(e, idx);
    });
    canvas.addEventListener('mouseleave', () => { this._tip = null; this.draw(); hideTip(); });
  }

  _showTip(e, idx) {
    let tip = document.getElementById('__chart_tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = '__chart_tip';
      tip.style.cssText = 'position:fixed;background:#16181f;border:1px solid #23252f;border-radius:6px;padding:6px 10px;font-size:11px;pointer-events:none;z-index:9999;white-space:nowrap;';
      document.body.appendChild(tip);
    }
    const vals = this.series.map((s,i) => {
      const v = s[s.length - (this.opts.maxPts - idx)] ?? 0;
      return `<span style="color:${this.opts.colors[i]}">${this.opts.labels[i]}: ${this.opts.fmtY(v)}</span>`;
    });
    tip.innerHTML = vals.join('&nbsp;&nbsp;');
    tip.style.left = (e.clientX + 12) + 'px';
    tip.style.top  = (e.clientY - 20) + 'px';
    tip.style.display = 'block';
  }
}

function hideTip() {
  const t = document.getElementById('__chart_tip');
  if (t) t.style.display = 'none';
}

class SparkLine {
  constructor(canvas, colors) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.colors = colors || ['#2ecc71','#4f7fff'];
    this.series = [[], []];
    this._ro    = new ResizeObserver(() => this.draw());
    this._ro.observe(canvas);
  }
  update(s) { this.series = s; this.draw(); }
  draw() {
    const { canvas, ctx, colors, series } = this;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width || canvas.parentElement?.offsetWidth || 100;
    const H = 30;
    if (W < 5) return;
    canvas.width  = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, W, H);

    const allVals = series.flat().filter(v => isFinite(v));
    const maxVal  = Math.max(...allVals) * 1.05 || 1;
    const n       = Math.max(...series.map(s => s.length));
    if (!n) return;

    series.forEach((data, si) => {
      if (!data.length) return;
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = i / (n - 1) * W;
        const y = H - (v / maxVal) * (H - 2) - 1;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = colors[si];
      ctx.lineWidth   = 1.2;
      ctx.stroke();
    });
  }
}

// ════════════════════════════════════════════════
// Config
// ════════════════════════════════════════════════
const API = '';
const CIRC = 2 * Math.PI * 40; // 251
let refreshAbortController = null;
let activeRefreshSignal = null;
const lastFetchAt = {};

// ════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════
const fmt = window.fmtRate;
const fmtB = window.fmtBytes;
const el = id => document.getElementById(id);
const escapeHtml = window.escapeHtml || (s => String(s ?? ''));
async function apiJson(path) {
  const res = await fetch(`${API}${path}`, { signal: activeRefreshSignal || undefined });
  return res.json();
}

function gauge(id, pct, val, detail) {
  const fill = el(`gf-${id}`);
  const offset = CIRC - CIRC * Math.min(pct, 100) / 100;
  fill.style.strokeDashoffset = offset;
  const origColor = { cpu:'var(--accent)', mem:'var(--green)', disk:'var(--purple)', temp:'var(--yellow)' }[id];
  fill.style.stroke = pct > 85 ? 'var(--red)' : pct > 65 ? 'var(--yellow)' : origColor;
  el(`gv-${id}`).textContent = val;
  if (detail !== undefined) el(`gd-${id}`).textContent = detail;
}

// ════════════════════════════════════════════════
// Navigation
// ════════════════════════════════════════════════
const pages = {
  dashboard:  { title: 'Dashboard',   sub: 'Обзор системы' },
  interfaces: { title: 'Interfaces',  sub: 'Сетевые интерфейсы' },
  traffic:    { title: 'Traffic',     sub: 'Мониторинг трафика в реальном времени' },
  dhcp:       { title: 'DHCP',        sub: 'Аренды IP-адресов' },
  vpn:        { title: 'VPN',         sub: 'WireGuard пиры' },
  routes:     { title: 'Routes',      sub: 'Таблица маршрутизации' },
  health:     { title: 'Health',      sub: 'Системное здоровье' },
  settings:   { title: 'Settings',    sub: 'Конфигурация' },
  logs:       { title: 'System Logs', sub: 'Журнал событий RouterOS' },
  report:     { title: 'Report',      sub: 'Сводный системный отчет' },
};
let currentPage = localStorage.getItem('current-page') || 'dashboard';

function navigate(page) {
  currentPage = page;
  localStorage.setItem('current-page', currentPage);
  document.querySelectorAll('.sb-item').forEach(i => {
    i.classList.toggle('active', i.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach(p => {
    p.classList.toggle('active', p.id === `p-${page}`);
  });
  const info = pages[page] || {};
  el('page-title').textContent = info.title || page;
  el('page-sub').textContent = info.sub || '';
  // Перерисовываем графики после того как страница стала видимой
  requestAnimationFrame(() => {
    dashChart.draw();
    trChart.draw();
    Object.values(sparks).forEach(s => s.draw());
  });
}

document.querySelectorAll('.sb-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navigate(item.dataset.page));
});

// Collapse sidebar
let collapsed = localStorage.getItem('sidebar-collapsed') === '1';
el('sidebar').classList.toggle('collapsed', collapsed);
el('collapse-btn').addEventListener('click', () => {
  collapsed = !collapsed;
  el('sidebar').classList.toggle('collapsed', collapsed);
  localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
  const arrow = el('collapse-btn').querySelector('svg');
  arrow.style.transform = collapsed ? 'rotate(180deg)' : '';
});

// ════════════════════════════════════════════════
// Charts (no dependencies)
// ════════════════════════════════════════════════
function makeMainChart(canvasId, height) {
  const canvas = el(canvasId);
  canvas.style.height = height + 'px';
  return new LineChart(canvas, { maxPts: 60, fmtY: fmt });
}

const dashChart = makeMainChart('dash-chart', 160);
const trChart   = makeMainChart('tr-chart',   200);

function updateChart(chart, hist) {
  if (!hist || !hist.length) return;
  chart.update([hist.map(p => p.rx), hist.map(p => p.tx)]);
}

// Sparklines
const sparks = {};
function getOrCreateSpark(containerId, name) {
  const key = containerId + name;
  if (sparks[key]) return sparks[key];
  const container = el(containerId);
  const row = document.createElement('div');
  row.className = 'spark-row';
  row.innerHTML = `<div class="spark-name" title="${name}">${name}</div>
    <canvas class="spark-canvas" id="spk-${containerId}-${name}"></canvas>
    <div class="spark-val" id="spkv-${containerId}-${name}">–</div>`;
  container.appendChild(row);
  const canvas = row.querySelector('canvas');
  const chart = new SparkLine(canvas);
  sparks[key] = chart;
  return chart;
}

function updateSpark(containerId, name, hist) {
  if (!hist || !hist.length) return;
  const chart = getOrCreateSpark(containerId, name);
  chart.update([hist.map(p => p.rx), hist.map(p => p.tx)]);
  const last  = hist.at(-1);
  const valEl = document.getElementById(`spkv-${containerId}-${name}`);
  if (valEl) valEl.innerHTML =
    `<span style="color:var(--green)">↓${fmt(last.rx)}</span> <span style="color:var(--accent)">↑${fmt(last.tx)}</span>`;
}

// ════════════════════════════════════════════════
// Iface tabs (shared state)
// ════════════════════════════════════════════════
let selectedIface = localStorage.getItem('selected-iface') || 'ether1';
let knownIfaceNames = [];

function buildTabs(containerId, chartObj, labelId) {
  const container = el(containerId);
  container.innerHTML = '';
  knownIfaceNames.forEach(name => {
    const b = document.createElement('button');
    b.className = 'iface-tab' + (name === selectedIface ? ' active' : '');
    b.textContent = name;
    b.onclick = () => {
      selectedIface = name;
      localStorage.setItem('selected-iface', selectedIface);
      document.querySelectorAll('.iface-tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll(`.iface-tab`).forEach(x => {
        if (x.textContent === name) x.classList.add('active');
      });
      if (labelId) el(labelId).textContent = name;
    };
    container.appendChild(b);
  });
  if (labelId) el(labelId).textContent = selectedIface;
}

// ════════════════════════════════════════════════
// Fetch & Render
// ════════════════════════════════════════════════
async function fetchSystem() {
  const d = await apiJson('/api/system');
  el('sb-router-name').textContent = `${d.identity}  ·  RouterOS ${d.version}`;
  el('page-sub').textContent = `uptime: ${d.uptime}`;

  const memPct  = Math.round((1 - d.free_memory  / d.total_memory) * 100);
  const diskPct = Math.round((1 - d.free_hdd     / d.total_hdd)    * 100);
  gauge('cpu',  d.cpu_load, d.cpu_load, '');
  gauge('mem',  memPct,  memPct,  `${fmtMB(d.total_memory - d.free_memory)} / ${fmtMB(d.total_memory)}`);
  gauge('disk', diskPct, diskPct, `${fmtMB(d.total_hdd - d.free_hdd)} / ${fmtMB(d.total_hdd)}`);
  if (d.temperature != null)
    gauge('temp', Math.round(d.temperature / 85 * 100), d.temperature, 'CPU temp');
  else
    gauge('temp', 0, '—', 'N/A');

  // Settings page
  el('settings-info').innerHTML = `
    <tr><td style="color:var(--muted)">Роутер</td><td>${escapeHtml(d.identity)}</td></tr>
    <tr><td style="color:var(--muted)">Модель</td><td>${escapeHtml(d.board)}</td></tr>
    <tr><td style="color:var(--muted)">RouterOS</td><td>${escapeHtml(d.version)}</td></tr>
    <tr><td style="color:var(--muted)">Uptime</td><td>${escapeHtml(d.uptime)}</td></tr>
    <tr><td style="color:var(--muted)">API URL</td><td>${API}</td></tr>
  `;

  // Health page sys
  el('health-sys').innerHTML = `
    <tr><td style="color:var(--muted)">CPU нагрузка</td>
      <td><span class="badge ${d.cpu_load>85?'b-red':d.cpu_load>65?'b-yellow':'b-green'}">${d.cpu_load}%</span></td></tr>
    <tr><td style="color:var(--muted)">Память занято</td>
      <td><span class="badge ${memPct>85?'b-red':memPct>65?'b-yellow':'b-green'}">${memPct}%</span>
          <span style="color:var(--muted);font-size:11px;margin-left:6px">${fmtMB(d.total_memory-d.free_memory)} / ${fmtMB(d.total_memory)}</span></td></tr>
    <tr><td style="color:var(--muted)">Диск занято</td>
      <td><span class="badge ${diskPct>85?'b-red':diskPct>65?'b-yellow':'b-green'}">${diskPct}%</span>
          <span style="color:var(--muted);font-size:11px;margin-left:6px">${fmtMB(d.total_hdd-d.free_hdd)} / ${fmtMB(d.total_hdd)}</span></td></tr>
    <tr><td style="color:var(--muted)">Температура CPU</td>
      <td>${d.temperature != null ? `<span class="badge ${d.temperature>70?'b-red':d.temperature>55?'b-yellow':'b-green'}">${d.temperature}°C</span>` : '—'}</td></tr>
    <tr><td style="color:var(--muted)">Uptime</td><td>${escapeHtml(d.uptime)}</td></tr>
  `;
}

async function fetchInterfaces() {
  const list = await apiJson('/api/interfaces');
  const ifaceFilter = el('iface-filter')?.value || 'all';
  const visible = list.filter(i => {
    if (ifaceFilter === 'up') return i.running && !i.disabled;
    if (ifaceFilter === 'down') return !i.running || i.disabled;
    return true;
  });

  // Update known interfaces for tabs
  const names = list.filter(i => !i.disabled).map(i => i.name);
  if (JSON.stringify(names) !== JSON.stringify(knownIfaceNames)) {
    knownIfaceNames = names;
    buildTabs('dash-tabs', dashChart, 'dash-iface-label');
    buildTabs('tr-tabs',   trChart,   'tr-label');
  }

  // Tiles (interfaces page)
  el('iface-tiles').innerHTML = visible.filter(i => !i.disabled).map(i => `
    <div class="iface-tile" draggable="true">
      <span class="i-dot" style="background:${i.running?'var(--green)':'var(--red)'}"></span>
      <div class="iface-tile-info">
        <div class="iface-tile-name">${escapeHtml(i.name)}</div>
        <div class="iface-tile-type">${escapeHtml(i.type)}</div>
      </div>
      <div class="iface-tile-stats">
        <div class="rx">↓ ${fmtB(i.rx_bytes)}</div>
        <div class="tx">↑ ${fmtB(i.tx_bytes)}</div>
      </div>
    </div>
  `).join('');
  enableDnD('iface-tiles', '.iface-tile', false);

  // Full table
  el('iface-tbody').innerHTML = visible.map(i => `
    <tr>
      <td><span class="i-dot" style="background:${i.disabled?'var(--border)':i.running?'var(--green)':'var(--red)'}"></span>${escapeHtml(i.name)}</td>
      <td style="color:var(--muted)">${escapeHtml(i.type)}</td>
      <td style="color:var(--green)">${fmtB(i.rx_bytes)}</td>
      <td style="color:var(--accent)">${fmtB(i.tx_bytes)}</td>
      <td style="color:var(--red)">${i.rx_drop || '0'}</td>
      <td style="color:var(--red)">${i.tx_drop || '0'}</td>
      <td>${i.disabled ? '<span class="badge b-yellow">disabled</span>'
          : i.running  ? '<span class="badge b-green">up</span>'
                       : '<span class="badge b-red">down</span>'}</td>
    </tr>
  `).join('');
}

async function fetchTraffic() {
  const data = await apiJson('/api/traffic');

  // Main charts
  if (data[selectedIface]) {
    updateChart(dashChart, data[selectedIface]);
    updateChart(trChart,   data[selectedIface]);
  }

  // Sparklines
  for (const [name, hist] of Object.entries(data)) {
    if (!hist.length) continue;
    updateSpark('dash-sparks', name, hist);
    updateSpark('tr-sparks',   name, hist);
  }
  enableDnD('tr-sparks', '.spark-row', true);
}

function hsClass(hs) {
  if (!hs) return 'hs-dead';
  const m = hs.match(/(\d+)([smhd])/);
  if (!m) return 'hs-ok';
  const secs = { s:1, m:60, h:3600, d:86400 }[m[2]] * parseInt(m[1]);
  return secs < 120 ? 'hs-ok' : secs < 3600 ? 'hs-warn' : 'hs-dead';
}

async function fetchVPN() {
  const peers = await apiJson('/api/vpn');
  const connected = peers.filter(p => p.connected).length;

  el('dash-vpn-count').textContent = `(${connected}/${peers.length})`;

  const vpnRow = p => `
    <tr>
      <td style="font-size:11px;font-family:monospace">${escapeHtml((p.allowed || '').replace('/32','').replace(',::/0',''))}</td>
      <td class="${hsClass(p.last_handshake)}" style="font-size:11px">${escapeHtml(p.last_handshake || '—')}</td>
      <td style="color:var(--green);font-size:11px">${fmtB(p.rx_bytes)}</td>
      <td style="color:var(--accent);font-size:11px">${fmtB(p.tx_bytes)}</td>
      <td>${p.connected ? '<span class="badge b-green">OK</span>' : '<span class="badge b-red">off</span>'}</td>
    </tr>`;

  el('dash-vpn-body').innerHTML = peers.slice(0, 8).map(vpnRow).join('');
  el('vpn-tbody').innerHTML = peers.map(p => `
    <tr draggable="true">
      <td style="font-family:monospace;font-size:11px">${escapeHtml(p.allowed.replace(',::/0',''))}</td>
      <td style="color:var(--muted)">${escapeHtml(p.name)}</td>
      <td class="${hsClass(p.last_handshake)}">${p.last_handshake || '—'}</td>
      <td style="color:var(--green)">${fmtB(p.rx_bytes)}</td>
      <td style="color:var(--accent)">${fmtB(p.tx_bytes)}</td>
      <td>${p.connected ? '<span class="badge b-green">connected</span>' : '<span class="badge b-red">offline</span>'}</td>
    </tr>`).join('');
  enableDnD('vpn-tbody', 'tr', true);
}

async function fetchDHCP() {
  const list = await apiJson('/api/dhcp');
  const q = (el('dhcp-search')?.value || '').trim().toLowerCase();
  const filtered = q ? list.filter(l =>
    String(l.address || '').toLowerCase().includes(q) ||
    String(l.mac || '').toLowerCase().includes(q) ||
    String(l.hostname || '').toLowerCase().includes(q)
  ) : list;
  el('dash-dhcp-count').textContent = `(${filtered.length})`;
  el('dhcp-total').textContent = `(${filtered.length})`;

  const dhcpRow = l => `
    <tr>
      <td style="font-family:monospace">${l.address}</td>
      <td>${escapeHtml(l.hostname || '—')}</td>
      <td style="color:var(--muted);font-size:11px">${l.mac}</td>
      <td><span class="badge ${l.status==='bound'?'b-green':'b-blue'}">${l.status}</span></td>
    </tr>`;

  el('dash-dhcp-body').innerHTML = filtered.slice(0, 8).map(dhcpRow).join('');
  el('dhcp-tbody').innerHTML = filtered.map(l => `
    <tr draggable="true">
      <td style="font-family:monospace">${l.address}</td>
      <td style="font-size:11px">${l.mac}</td>
      <td>${escapeHtml(l.hostname || '—')}</td>
      <td><span class="badge ${l.status==='bound'?'b-green':'b-blue'}">${l.status}</span></td>
      <td style="color:var(--muted);font-size:11px">${l.expires || '—'}</td>
    </tr>`).join('');
  enableDnD('dhcp-tbody', 'tr', true);
}

async function fetchRoutes() {
  const list = await apiJson('/api/routes');
  el('routes-tbody').innerHTML = list.map(r => `
    <tr>
      <td style="font-family:monospace">${escapeHtml(r.dst)}</td>
      <td style="font-family:monospace">${escapeHtml(r.gateway || '—')}</td>
      <td style="color:var(--muted)">${escapeHtml(r.iface || '—')}</td>
      <td style="color:var(--muted)">${r.distance}</td>
    </tr>`).join('');
}

async function fetchLogs() {
  const list = await apiJson('/api/logs');
  const q = (el('logs-filter')?.value || '').trim().toLowerCase();
  const filtered = q ? list.filter(l =>
    String(l.topics || '').toLowerCase().includes(q) ||
    String(l.message || '').toLowerCase().includes(q)
  ) : list;
  if (!filtered.length) { el('logs-tbody').innerHTML = '<tr><td colspan="3">No logs</td></tr>'; return; }
  
  el('logs-tbody').innerHTML = filtered.map(l => {
    let color = 'var(--text)';
    const t = escapeHtml(l.topics || '');
    if (t.includes('critical') || t.includes('error')) color = 'var(--red)';
    else if (t.includes('warning')) color = 'var(--yellow)';
    else if (t.includes('system') || t.includes('info')) color = 'var(--muted)';
    return `<tr>
      <td style="color:var(--muted);white-space:nowrap">${escapeHtml(l.time||'')}</td>
      <td><span class="badge" style="background:none;border:1px solid var(--border);color:${color}">${t}</span></td>
      <td style="color:${color}">${escapeHtml(l.message||'')}</td>
    </tr>`;
  }).reverse().join('');
}

function generateMarkdownReport(data) {
  const { sys, ifaces, dhcp, vpn, timestamp } = data;
  const fmtB = window.fmtBytes;
  let md = `# MikroTik Diagnostic Report\n*Generated at: ${timestamp}*\n\n`;
  
  md += `## 1. System Info\n- **Identity**: ${sys.identity}\n- **RouterOS**: ${sys.version}\n- **Board**: ${sys.board}\n- **Uptime**: ${sys.uptime}\n`;
  md += `- **CPU**: ${sys.cpu_load}%\n- **Memory**: ${fmtMB(sys.total_memory - sys.free_memory)} / ${fmtMB(sys.total_memory)} USED\n- **Storage**: ${fmtMB(sys.total_hdd - sys.free_hdd)} / ${fmtMB(sys.total_hdd)} USED\n\n`;
  
  md += `## 2. Interfaces\n`;
  ifaces.forEach(i => {
    md += `- **${i.name}** (${i.type}): ${i.running ? 'UP' : 'DOWN'}${i.disabled ? ' [DISABLED]' : ''} | RX: ${fmtB(i.rx_bytes)} | TX: ${fmtB(i.tx_bytes)}\n`;
  });
  
  md += `\n## 3. DHCP Leases (${dhcp.length})\n`;
  dhcp.forEach(l => md += `- ${l.address} [${l.mac}] ${l.hostname || 'Unknown'} (${l.status})\n`);
  
  md += `\n## 4. VPN Peers (${vpn.length})\n`;
  vpn.forEach(p => md += `- ${p.name} -> ${p.allowed} | Handshake: ${p.last_handshake || 'Never'} | RX: ${fmtB(p.rx_bytes)} | TX: ${fmtB(p.tx_bytes)}\n`);
  
  return md;
}

async function fetchReport() {
  const data = await apiJson('/api/report');
  el('report-content').textContent = generateMarkdownReport(data);
}

async function fetchHealthSummary() {
  const health = await apiJson('/api/health-summary');
  if (!health || !health.checks) return;

  const checks = health.checks;
  const badgeCls = s => s === 'critical' ? 'b-red' : s === 'warning' ? 'b-yellow' : 'b-green';
  const val = v => (v == null ? '—' : escapeHtml(v));
  el('health-sys').innerHTML = `
    <tr><td style="color:var(--muted)">CPU</td><td><span class="badge ${badgeCls(checks.cpu.status)}">${checks.cpu.status}</span> <span style="margin-left:6px">${val(checks.cpu.value)}%</span></td></tr>
    <tr><td style="color:var(--muted)">Memory</td><td><span class="badge ${badgeCls(checks.memory.status)}">${checks.memory.status}</span> <span style="margin-left:6px">${val(checks.memory.value)}%</span></td></tr>
    <tr><td style="color:var(--muted)">Disk</td><td><span class="badge ${badgeCls(checks.disk.status)}">${checks.disk.status}</span> <span style="margin-left:6px">${val(checks.disk.value)}%</span></td></tr>
    <tr><td style="color:var(--muted)">Temp</td><td><span class="badge ${badgeCls(checks.temp.status)}">${checks.temp.status}</span> <span style="margin-left:6px">${val(checks.temp.value)}${checks.temp.value == null ? '' : '°C'}</span></td></tr>
  `;

  if (Array.isArray(health.alerts) && health.alerts.length) {
    el('alert-banner').classList.remove('hidden');
    el('alert-text').textContent = health.alerts.join('; ');
  }
  el('health-sensors').innerHTML = `
    <tr><td style="color:var(--muted)">Reachable</td><td>${health.reachable ? 'yes' : 'no'}</td></tr>
    <tr><td style="color:var(--muted)">Severity</td><td>${escapeHtml(health.severity || 'unknown')}</td></tr>
    <tr><td style="color:var(--muted)">Alerts</td><td>${escapeHtml((health.alerts || []).join('; ') || 'none')}</td></tr>
    <tr><td style="color:var(--muted)">Updated</td><td>${escapeHtml(health.timestamp || new Date().toISOString())}</td></tr>
  `;
}

function due(key, intervalMs) {
  const now = Date.now();
  if (!lastFetchAt[key] || now - lastFetchAt[key] >= intervalMs) {
    lastFetchAt[key] = now;
    return true;
  }
  return false;
}

// ════════════════════════════════════════════════
// Auth / Login
// ════════════════════════════════════════════════
async function checkAuth() {
  try {
    const r = await fetch(`${API}/api/system`);
    if (r.status === 401) {
      el('login-overlay').classList.remove('hidden');
      return false;
    }
    el('login-overlay').classList.add('hidden');
    return true;
  } catch(e) {
    el('login-overlay').classList.add('hidden');
    return true;
  }
}

el('login-btn').addEventListener('click', async () => {
  const token = el('login-token').value.trim();
  if (!token) return;
  el('login-err').textContent = '';
  try {
    const r = await fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const d = await r.json();
    if (d.ok) {
      el('login-overlay').classList.add('hidden');
      refresh();
    } else {
      el('login-err').textContent = d.error || 'Invalid token';
    }
  } catch(e) {
    el('login-err').textContent = 'Connection error';
  }
});

el('login-token').addEventListener('keydown', e => {
  if (e.key === 'Enter') el('login-btn').click();
});

// ════════════════════════════════════════════════
// WebSocket (real-time traffic updates)
// ════════════════════════════════════════════════
let ws = null;
let wsReconnectTimer = null;

function connectWs() {
  if (ws) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'traffic') {
        for (const [name, hist] of Object.entries(msg.data)) {
          if (!hist.length) continue;
          updateSpark('dash-sparks', name, hist);
          updateSpark('tr-sparks', name, hist);
        }
        if (msg.data[selectedIface]) {
          updateChart(dashChart, msg.data[selectedIface]);
          updateChart(trChart, msg.data[selectedIface]);
        }
      }
    } catch(_) {}
  };
  ws.onclose = () => {
    ws = null;
    wsReconnectTimer = setTimeout(connectWs, 3000);
  };
  ws.onerror = () => { ws.close(); };
}

connectWs();

// ════════════════════════════════════════════════
// Main refresh loop
// ════════════════════════════════════════════════
let errCount = 0;

async function refresh() {
  if (refreshAbortController) refreshAbortController.abort();
  refreshAbortController = new AbortController();
  activeRefreshSignal = refreshAbortController.signal;
  const tasks = [fetchSystem(), fetchTraffic()];
  if (currentPage === 'interfaces' && due('interfaces', 6000)) tasks.push(fetchInterfaces());
  if (currentPage === 'dhcp' && due('dhcp', 15000)) tasks.push(fetchDHCP());
  if (currentPage === 'vpn' && due('vpn', 6000)) tasks.push(fetchVPN());
  if (currentPage === 'routes' && due('routes', 15000)) tasks.push(fetchRoutes());
  if (currentPage === 'logs') tasks.push(fetchLogs());
  if (currentPage === 'report') tasks.push(fetchReport());
  if (currentPage === 'health' && due('health-summary', 3000)) tasks.push(fetchHealthSummary());
  if (currentPage === 'dashboard') {
    if (due('interfaces', 6000)) tasks.push(fetchInterfaces());
    if (due('vpn', 6000)) tasks.push(fetchVPN());
    if (due('dhcp', 15000)) tasks.push(fetchDHCP());
    if (due('routes', 15000)) tasks.push(fetchRoutes());
    if (due('health-summary', 3000)) tasks.push(fetchHealthSummary());
  }

  const results = await Promise.allSettled(tasks);
  if (activeRefreshSignal?.aborted) return;
  const failed = results.filter(r => r.status === 'rejected' && r.reason?.name !== 'AbortError');
  if (failed.length) {
    errCount++;
    if (errCount > 2) {
      const banner = el('alert-banner');
      banner.classList.remove('hidden');
      el('alert-text').textContent = `Ошибок запросов: ${failed.length}`;
    }
  } else {
    errCount = 0;
    const banner = el('alert-banner');
    banner.classList.add('hidden');
    el('last-update').textContent = 'Обновлено: ' + new Date().toLocaleTimeString('ru');
  }
}

navigate(currentPage);
el('logs-filter')?.addEventListener('input', () => { if (currentPage === 'logs') refresh(); });
el('dhcp-search')?.addEventListener('input', () => { if (currentPage === 'dhcp') refresh(); });
el('iface-filter')?.addEventListener('change', () => { if (currentPage === 'interfaces') refresh(); });
checkAuth().then(ok => { if (ok) refresh(); });
setInterval(() => {
  const locked = !el('login-overlay').classList.contains('hidden');
  if (!locked) refresh();
}, 3000);

// ════════════════════════════════════════════════
// Drag-and-drop для плиток на Dashboard
// ════════════════════════════════════════════════
// ════════════════════════════════════════════════
// Универсальный drag-and-drop для динамических списков
// ════════════════════════════════════════════════
const _dndBound = new Set();

function enableDnD(containerId, childSel, vertical) {
  const container = el(containerId);
  if (!container) return;

  // Помечаем текущие дочерние элементы как draggable
  container.querySelectorAll(childSel).forEach(child => {
    child.draggable = true;
  });

  // Слушатели навешиваем только один раз
  if (_dndBound.has(containerId)) return;
  _dndBound.add(containerId);

  let src = null;
  const phId = '__dnd_ph_' + containerId;

  function makePH(ref) {
    const isTable = ref.tagName === 'TR';
    const ph = document.createElement(isTable ? 'tr' : 'div');
    ph.id = phId;
    ph.draggable = false;
    if (isTable) {
      const td = document.createElement('td');
      td.colSpan = 99;
      td.style.cssText = 'padding:2px 0;';
      const line = document.createElement('div');
      line.style.cssText = 'height:2px;background:var(--accent);border-radius:2px;';
      td.appendChild(line);
      ph.appendChild(td);
    } else {
      ph.style.cssText = `
        ${vertical
          ? `height:${ref.offsetHeight}px;`
          : `width:${ref.offsetWidth}px;min-height:${ref.offsetHeight}px;flex-shrink:0;`}
        border: 2px dashed var(--accent);
        border-radius: 8px;
        opacity: .4;
        background: var(--accent-bg);
        pointer-events: none;
      `;
    }
    return ph;
  }

  container.addEventListener('dragstart', e => {
    const item = e.target.closest(childSel);
    if (!item || !item.draggable) return;
    src = item;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => src && src.classList.add('dnd-dragging'), 0);
  });

  container.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!src) return;
    const target = e.target.closest(childSel);
    if (!target || target === src) return;
    let ph = document.getElementById(phId);
    if (!ph) ph = makePH(src);
    const rect = target.getBoundingClientRect();
    const before = vertical
      ? e.clientY < rect.top + rect.height / 2
      : e.clientX < rect.left + rect.width / 2;
    if (before) target.before(ph);
    else target.after(ph);
  });

  container.addEventListener('dragleave', e => {
    if (!container.contains(e.relatedTarget)) {
      const ph = document.getElementById(phId);
      if (ph) ph.remove();
    }
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    if (!src) return;
    const ph = document.getElementById(phId);
    if (ph) { ph.before(src); ph.remove(); }
    src.classList.remove('dnd-dragging');
    src = null;
  });

  container.addEventListener('dragend', () => {
    const ph = document.getElementById(phId);
    if (ph) ph.remove();
    if (src) { src.classList.remove('dnd-dragging'); src = null; }
  });
}

(function initTileDnD() {
  const row = el('gauges-row');
  let dragSrc = null;
  let placeholder = null;

  function getCards() {
    return [...row.querySelectorAll('.gauge-card')];
  }

  // Восстанавливаем сохранённый порядок
  const saved = localStorage.getItem('gauge-order');
  if (saved) {
    try {
      const ids = JSON.parse(saved);
      ids.forEach(id => {
        const card = row.querySelector(`#${id}`) || row.querySelector(`[data-gid="${id}"]`);
        if (card) row.appendChild(card);
      });
    } catch(_) {}
  }

  // Назначаем data-gid всем картам если нет id
  getCards().forEach((card, i) => {
    if (!card.id) card.id = `gc-${i}`;
  });

  function saveOrder() {
    const ids = getCards().map(c => c.id);
    localStorage.setItem('gauge-order', JSON.stringify(ids));
  }

  function nearestCard(x) {
    // Определяем ближайшую карту по горизонтали для вставки
    const cards = getCards().filter(c => c !== dragSrc);
    let best = null, bestX = Infinity;
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      const midX = r.left + r.width / 2;
      if (Math.abs(x - midX) < bestX) {
        bestX = Math.abs(x - midX);
        best = { card, before: x < midX };
      }
    }
    return best;
  }

  row.addEventListener('dragstart', e => {
    const card = e.target.closest('.gauge-card');
    if (!card) return;
    dragSrc = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);

    // Создаём placeholder такого же размера
    placeholder = document.createElement('div');
    placeholder.style.cssText = `
      width: ${card.offsetWidth}px;
      min-height: ${card.offsetHeight}px;
      border: 2px dashed var(--accent);
      border-radius: 10px;
      opacity: .4;
      background: var(--accent-bg);
      pointer-events: none;
    `;
    placeholder.id = '__dnd_placeholder';
  });

  row.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragSrc) return;

    const target = e.target.closest('.gauge-card');
    const ph = el('__dnd_placeholder');

    // Убираем highlight со всех
    getCards().forEach(c => c.classList.remove('drag-over'));

    if (target && target !== dragSrc) {
      target.classList.add('drag-over');
      const rect = target.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;

      // Перемещаем placeholder
      if (ph) {
        if (before) {
          row.insertBefore(ph, target);
        } else {
          row.insertBefore(ph, target.nextSibling);
        }
      }
    }
  });

  row.addEventListener('dragleave', e => {
    if (!row.contains(e.relatedTarget)) {
      getCards().forEach(c => c.classList.remove('drag-over'));
    }
  });

  row.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragSrc) return;

    const ph = el('__dnd_placeholder');
    if (ph) {
      row.insertBefore(dragSrc, ph);
      ph.remove();
    }

    getCards().forEach(c => c.classList.remove('drag-over'));
    dragSrc.classList.remove('dragging');
    saveOrder();
    dragSrc = null;
  });

  row.addEventListener('dragend', () => {
    const ph = el('__dnd_placeholder');
    if (ph) ph.remove();
    if (dragSrc) {
      dragSrc.classList.remove('dragging');
      dragSrc = null;
    }
    getCards().forEach(c => c.classList.remove('drag-over'));
  });
})();
