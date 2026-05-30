// discovery/demo-preview.js
// ─── DEMO PREVIEW PAGE · /discovery/p/:token/demo ────────────────────────────
// Native payload-driven dashboard renderer.
// Replaces the old iframe + static-template approach.
// Modes:
//   Demo  — token === 'demo' or ?demo=1  → DEMO_PAYLOAD fixture, no backend
//   Live  — any other token              → GET /api/discovery/demo?token=<t>
//   Internal additions when ?internal=1  → inline edit + regenerate + edit badge

import { animate, stagger } from './vendor/anime.esm.js';
import { getLang, t } from './i18n.js';
import { api } from './api.js';

// ─── REDUCED MOTION ──────────────────────────────────────────────────────────
const RM = window.matchMedia('(prefers-reduced-motion: reduce)');

// ─── DEMO FIXTURE ─────────────────────────────────────────────────────────────
const DEMO_PAYLOAD = {
  company:       'Distribuidora Andina',
  prospect_name: 'Mariana',
  sector:        'distribucion',
  sector_label:  'Distribución',
  headline:      'What 90 days with Arqentia could look like for Distribuidora Andina.',
  kpis: [
    { label: '// WEEKLY CLOSE TIME',       value: '4 h',   delta: '↘ −2.6 d',  context: 'from 3 days, first 30 days live' },
    { label: '// RECONCILIATION ACCURACY', value: '99.2%', delta: '↗ +12 pts', context: 'across 4 source systems' },
    { label: '// HOURS RETURNED / WEEK',   value: '18 h',  delta: '↗ +18 h',   context: 'you + 2 staff' },
    { label: '// ROUTE COMPLIANCE',        value: '94%',   delta: '↗ +6 pts',  context: '380 bodegas tracked' },
    { label: '// CFO SIGN-OFF',            value: 'live',  delta: 'real-time', context: 'no monday-morning wait' },
    { label: '// PROJECTED PAYBACK',       value: '3 mo',  delta: '✓ on plan', context: 'vs build + maintenance fee' }
  ],
  chart: {
    title:    '// WEEKLY CLOSE TIME · PROJECTED',
    subtitle: '12 weeks if you build with us',
    y_label:  'hours',
    data:     [72, 64, 56, 44, 32, 24, 18, 12, 8, 6, 5, 4]
  },
  insights: [
    {
      headline: 'Distribuidora Andina closes weekly in 4 hours instead of 3 days.',
      body:     'Sales (412 orders), Ops (388 picks), and Warehouse (401 verified) reconcile against your SAP B1 ledger automatically — your team reviews exceptions, not totals.'
    },
    {
      headline: 'Route 12 / Lima Norte returns are 37% of weekly losses.',
      body:     'The dashboard flags returns by route + customer + SKU. You spot the pattern before the CFO asks. Currently invisible in your spreadsheets.'
    },
    {
      headline: 'Your CFO sees the same number you do, at the same time.',
      body:     'No more Monday-morning reconciliation. The KPI dashboard is the single source of truth — every number cites its source rows.'
    }
  ],
  activity: [
    { when: 'Today 09:14',     event: 'Auto-reconciliation completed · 4 spreadsheets · 0 exceptions', owner: 'Arqentia Core',     value: '✓' },
    { when: 'Today 08:42',     event: 'Route 12 / Lima Norte · 18 stops delivered',                    owner: 'J. Rodríguez',      value: 'S/. 14.2K' },
    { when: 'Yesterday 18:02', event: 'Stockout flagged · SKU-4480 · below reorder point',             owner: 'Almacén M. Torres', value: 'S/. 8.6K' },
    { when: 'Yesterday 15:30', event: 'Return registered · damaged pallet · Cliente Mayorista S.A.',   owner: 'Route 07 · System', value: 'S/. 5.2K' },
    { when: '2 days ago',      event: 'New order · 240 cases · scheduled May 24',                      owner: 'Ventas · P. García', value: 'S/. 31.1K' }
  ],
  capability: {
    code:  'C.01 + C.04',
    label: 'Dashboards + Integration',
    why:   'Your bottleneck is data scattered across 4 spreadsheets + SAP + WhatsApp. Dashboards alone won\'t fix it without integration to consolidate the truth first.'
  },
  pricing: {
    tier:     'Build + Maintenance',
    headline: 'Build $8K + $500/mo maintenance',
    sub:      'Scoped to reconciliation engine + KPI dashboard + 4 sector connectors'
  }
};

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  payload:    null,
  token:      '',
  isDemo:     false,
  isInternal: false,
  saveTimer:  null,
  rendered:   false,
  chat: {
    open:     false,
    messages: [],   // [{role: 'user'|'assistant', content: string, ts: number}]
    pending:  false,
    error:    null,
    everOpened: false
  }
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getToken() {
  const sp = new URLSearchParams(location.search);
  if (sp.has('token')) return sp.get('token');
  const m = location.pathname.match(/\/discovery\/p\/([^/?#]+)\/demo/);
  return m ? m[1] : '';
}

function isDemo() {
  const sp = new URLSearchParams(location.search);
  if (sp.get('demo') === '1') return true;
  const token = getToken();
  return token === 'demo';
}

function isInternal() {
  return new URLSearchParams(location.search).get('internal') === '1';
}

function getProfileUrl() {
  return location.pathname.replace(/\/demo$/, '') || `/discovery/p/${state.token}`;
}

// ─── LUCIDE PENCIL SVG (14px, inline-edit indicator) ─────────────────────────
const PENCIL_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"
  aria-hidden="true" focusable="false">
  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
</svg>`;

// ─── EDITABLE NODE WRAPPER ────────────────────────────────────────────────────
// Returns the HTML for a text node that becomes contenteditable in internal mode.
// Strip any HTML tags from a string — agents sometimes emit `<b>...</b>` or
// `<em>` in fields despite being told not to. We render everything as plain
// text via esc(), so a stray tag would show literally. Strip first.
function stripHtml(s) {
  return String(s ?? '').replace(/<\/?[a-z][^>]*>/gi, '');
}

function editNode(text, path, tag = 'span') {
  const clean = stripHtml(text);
  if (!state.isInternal) return `<${tag}>${esc(clean)}</${tag}>`;
  return `<${tag}
    contenteditable="true"
    data-payload-path="${esc(path)}"
    class="disc-demo-dash__editable"
    spellcheck="false"
    aria-label="Edit ${esc(path)}">${esc(clean)}</${tag}><span class="disc-demo-dash__edit-pencil" aria-hidden="true">${PENCIL_SVG}</span>`;
}

// ─── SVG CHART ────────────────────────────────────────────────────────────────
// Dispatcher — picks the right renderer based on chart.chart_type. Backwards
// compatible with old payloads where `chart` only has a flat `data` array.
function buildChartFromPayload(chart) {
  if (!chart) return '';
  const type = chart.chart_type || 'line';
  // Legacy: chart.data is a flat array of numbers → render as line
  if (Array.isArray(chart.data) && chart.data.length && typeof chart.data[0] === 'number') {
    return buildLineChart(chart.data);
  }
  switch (type) {
    case 'bar':       return buildBarChart(chart.data || []);
    case 'pie':
    case 'donut':     return buildPieChart(chart.data || [], type === 'donut');
    case 'histogram': return buildHistogram(chart.data || []);
    case 'step':      return buildLineChart((chart.data || []).map(d => typeof d === 'number' ? d : d.value), { step: true });
    case 'area':      return buildLineChart((chart.data || []).map(d => typeof d === 'number' ? d : d.value), { area: true });
    case 'combo':     return buildComboChart(chart.data || [], chart.line_label, chart.bar_label);
    case 'line':
    default:          return buildLineChart((chart.data || []).map(d => typeof d === 'number' ? d : d.value));
  }
}

// ── BAR (categorical) ────────────────────────────────────────────────────────
function buildBarChart(data) {
  if (!Array.isArray(data) || !data.length) return '';
  const W = 520, H = 200, PAD = { t: 14, r: 12, b: 56, l: 36 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const max = Math.max(...data.map(d => Number(d.value) || 0)) || 1;
  const barW = plotW / data.length * 0.7;
  const gap  = plotW / data.length * 0.3;
  const bars = data.map((d, i) => {
    const x = PAD.l + i * (barW + gap) + gap / 2;
    const h = (Number(d.value) || 0) / max * plotH;
    const y = PAD.t + plotH - h;
    return `<g>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" class="disc-demo-dash__chart-bar"/>
      <text x="${(x + barW/2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" class="disc-demo-dash__chart-bar-val">${esc(String(d.value))}</text>
      <text x="${(x + barW/2).toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="middle" class="disc-demo-dash__chart-bar-label">${esc(String(d.label || '').slice(0, 14))}</text>
    </g>`;
  }).join('');
  return `<svg class="disc-demo-dash__chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">${bars}</svg>`;
}

// ── PIE / DONUT ──────────────────────────────────────────────────────────────
function buildPieChart(data, donut = false) {
  if (!Array.isArray(data) || !data.length) return '';
  const W = 520, H = 220, cx = 110, cy = 110, R = 90, r = donut ? 48 : 0;
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0) || 1;
  const palette = ['#60a5fa', '#86efac', '#fde68a', '#fca5a5', '#d8b4fe', '#7dd3fc'];
  let cumAngle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac = (Number(d.value) || 0) / total;
    const a1 = cumAngle;
    const a2 = cumAngle + frac * Math.PI * 2;
    cumAngle = a2;
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
    const large = a2 - a1 > Math.PI ? 1 : 0;
    let path;
    if (donut) {
      const ix1 = cx + r * Math.cos(a1), iy1 = cy + r * Math.sin(a1);
      const ix2 = cx + r * Math.cos(a2), iy2 = cy + r * Math.sin(a2);
      path = `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${ix2.toFixed(1)},${iy2.toFixed(1)} A${r},${r} 0 ${large} 0 ${ix1.toFixed(1)},${iy1.toFixed(1)} Z`;
    } else {
      path = `M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`;
    }
    return `<path d="${path}" fill="${palette[i % palette.length]}" opacity="0.85" />`;
  }).join('');
  // Legend
  const legend = data.map((d, i) => {
    const pct = ((Number(d.value) || 0) / total * 100).toFixed(0);
    const y = 18 + i * 22;
    return `<g transform="translate(240, ${y})">
      <rect width="12" height="12" fill="${palette[i % palette.length]}" opacity="0.85"/>
      <text x="20" y="10" class="disc-demo-dash__chart-legend">${esc(String(d.label || '').slice(0, 30))} · ${pct}%</text>
    </g>`;
  }).join('');
  return `<svg class="disc-demo-dash__chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">${slices}${legend}</svg>`;
}

// ── HISTOGRAM ─────────────────────────────────────────────────────────────────
function buildHistogram(data) {
  if (!Array.isArray(data) || !data.length) return '';
  const W = 520, H = 200, PAD = { t: 14, r: 12, b: 44, l: 36 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const max = Math.max(...data.map(d => Number(d.count) || 0)) || 1;
  const barW = plotW / data.length;
  const bars = data.map((d, i) => {
    const x = PAD.l + i * barW;
    const h = (Number(d.count) || 0) / max * plotH;
    const y = PAD.t + plotH - h;
    return `<g>
      <rect x="${(x + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${h.toFixed(1)}" class="disc-demo-dash__chart-bar"/>
      <text x="${(x + barW/2).toFixed(1)}" y="${(H - 22).toFixed(1)}" text-anchor="middle" class="disc-demo-dash__chart-bar-label">${esc(String(d.bin || ''))}</text>
      <text x="${(x + barW/2).toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="middle" class="disc-demo-dash__chart-bar-val">${esc(String(d.count))}</text>
    </g>`;
  }).join('');
  return `<svg class="disc-demo-dash__chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">${bars}</svg>`;
}

// ── COMBO (line + bar overlay) ────────────────────────────────────────────────
function buildComboChart(data, lineLabel, barLabel) {
  if (!Array.isArray(data) || !data.length) return '';
  const W = 520, H = 200, PAD = { t: 14, r: 12, b: 36, l: 36 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const lineVals = data.map(d => Number(d.line) || 0);
  const barVals  = data.map(d => Number(d.bar)  || 0);
  const maxL = Math.max(...lineVals) || 1;
  const maxB = Math.max(...barVals)  || 1;
  const barW = plotW / data.length * 0.6;
  const gap  = plotW / data.length * 0.4;
  const bars = data.map((d, i) => {
    const x = PAD.l + i * (barW + gap) + gap / 2;
    const h = (Number(d.bar) || 0) / maxB * plotH;
    const y = PAD.t + plotH - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" class="disc-demo-dash__chart-bar" opacity="0.5"/>`;
  }).join('');
  const linePts = data.map((d, i) => {
    const x = PAD.l + i * (barW + gap) + gap / 2 + barW / 2;
    const y = PAD.t + plotH - (Number(d.line) || 0) / maxL * plotH;
    return [x, y];
  });
  const linePath = linePts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return `<svg class="disc-demo-dash__chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">
    ${bars}
    <path d="${linePath}" class="disc-demo-dash__chart-line" />
  </svg>`;
}

function buildLineChart(data, opts = {}) {
  const W = 520, H = 160, PAD = { t: 12, r: 12, b: 28, l: 36 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = PAD.l + (i / (data.length - 1)) * plotW;
    const y = PAD.t + (1 - (v - min) / range) * plotH;
    return [x, y];
  });

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const fillPath = `${linePath} L${pts[pts.length - 1][0].toFixed(1)},${(PAD.t + plotH).toFixed(1)} L${PAD.l},${(PAD.t + plotH).toFixed(1)} Z`;

  // x-axis labels: Day 1, Day 6, Day 12 (sparse)
  const xLabels = [0, Math.floor((data.length - 1) / 2), data.length - 1].map(i => {
    const x = PAD.l + (i / (data.length - 1)) * plotW;
    const label = i === 0 ? 'Day 1' : i === data.length - 1 ? `Day ${(data.length) * 7 / 12 * 12}` : `Day ${Math.round(i * 7 * data.length / 12 / (data.length - 1) * (data.length - 1))}`;
    return `<text x="${x.toFixed(1)}" y="${(H - 6).toFixed(1)}" text-anchor="${i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}">${i === 0 ? 'Week 1' : i === data.length - 1 ? 'Week 12' : 'Week 6'}</text>`;
  });

  // y-axis: min and max
  const yLabels = [
    `<text x="${(PAD.l - 4).toFixed(1)}" y="${(PAD.t + plotH).toFixed(1)}" text-anchor="end">${min}</text>`,
    `<text x="${(PAD.l - 4).toFixed(1)}" y="${(PAD.t + 4).toFixed(1)}" text-anchor="end">${max}</text>`
  ];

  // Grid lines (2 horizontal)
  const gridLines = [0.5].map(f => {
    const y = PAD.t + f * plotH;
    return `<line x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${W - PAD.r}" y2="${y.toFixed(1)}" />`;
  });

  // Measure path length estimate for stroke-dashoffset animation
  // Approximation: sum of segment distances
  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i-1][0];
    const dy = pts[i][1] - pts[i-1][1];
    pathLen += Math.sqrt(dx * dx + dy * dy);
  }
  pathLen = Math.ceil(pathLen) + 20;

  return `
<svg class="disc-demo-dash__chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"
  aria-hidden="true" focusable="false" role="img">
  <defs>
    <linearGradient id="chart-fill-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="var(--arq)" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="var(--arq)" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="chart-clip">
      <rect x="${PAD.l}" y="${PAD.t}" width="${plotW}" height="${plotH}" />
    </clipPath>
  </defs>

  <g class="disc-demo-dash__chart-grid">
    ${gridLines.join('')}
  </g>

  <g clip-path="url(#chart-clip)">
    <path class="disc-demo-dash__chart-fill" d="${fillPath}" />
    <path class="disc-demo-dash__chart-line" d="${linePath}"
      stroke-dasharray="${pathLen}" stroke-dashoffset="${pathLen}"
      data-path-len="${pathLen}" />
  </g>

  <g class="disc-demo-dash__chart-labels">
    ${xLabels.join('')}
    ${yLabels.join('')}
  </g>
</svg>`;
}

// ─── GET NESTED PAYLOAD VALUE BY DOT PATH ─────────────────────────────────────
function getByPath(obj, path) {
  return path.split('.').reduce((cur, k) => (cur != null ? cur[k] : undefined), obj);
}

function setByPath(obj, path, val) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = isNaN(Number(keys[i + 1])) ? {} : [];
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = val;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
let _toastEl = null;
function showToast(msg, isError = false) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.className = 'disc-demo-dash__toast';
    _toastEl.setAttribute('role', 'status');
    _toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.classList.toggle('disc-demo-dash__toast--error', isError);
  _toastEl.style.opacity = '0';
  _toastEl.style.transform = 'translateY(12px)';
  _toastEl.style.pointerEvents = 'none';

  if (!RM.matches) {
    animate(_toastEl, { opacity: [0, 1], translateY: [12, 0], duration: 320, ease: 'outCubic' });
    setTimeout(() => {
      animate(_toastEl, { opacity: [1, 0], translateY: [0, 12], duration: 280, ease: 'inCubic' });
    }, 1800);
  } else {
    _toastEl.style.opacity = '1';
    _toastEl.style.transform = 'translateY(0)';
    setTimeout(() => {
      _toastEl.style.opacity = '0';
    }, 2000);
  }
}

// ─── SAVE (PATCH) ─────────────────────────────────────────────────────────────
async function savePatch() {
  if (!state.isInternal || state.isDemo) return;
  try {
    await api(`/demo?token=${encodeURIComponent(state.token)}&internal=1`, {
      method: 'PATCH',
      body: { payload: state.payload }
    });
    showToast(t('demo.page.saved_toast'));
  } catch {
    showToast(t('demo.page.save_failed_toast'), true);
  }
}

function scheduleSave() {
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(savePatch, 600);
}

// ─── EDIT BLUR HANDLER ────────────────────────────────────────────────────────
function onEditableBlur(e) {
  const el = e.target;
  if (!el.dataset.payloadPath) return;
  const newVal = el.textContent;
  setByPath(state.payload, el.dataset.payloadPath, newVal);
  scheduleSave();
}

function onEditableFocus(e) {
  e.target.classList.add('is-editing');
}

function onEditableBlurFocusOut(e) {
  e.target.classList.remove('is-editing');
}

// ─── BIND EDITABLE EVENTS ─────────────────────────────────────────────────────
function bindEditables(container) {
  if (!state.isInternal) return;
  container.querySelectorAll('[data-payload-path]').forEach(el => {
    el.addEventListener('focus', onEditableFocus);
    el.addEventListener('blur', e => {
      onEditableBlurFocusOut(e);
      onEditableBlur(e);
    });
    // Prevent Enter from inserting a newline — single-line fields
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });
}

// ─── REGENERATE ───────────────────────────────────────────────────────────────
async function triggerRegenerate() {
  // Demo mode: allow regenerate via the fixture path in internal mode
  const regenToken = state.isDemo ? 'demo' : state.token;
  renderPending();
  try {
    const result = await api(`/demo/regenerate?token=${encodeURIComponent(regenToken)}&internal=1`, { method: 'POST' });
    // Use the payload returned directly from the POST — avoids cache dependency.
    // For live tokens, also re-fetch from GET (Supabase-backed, persistent).
    if (result?.payload) {
      state.payload = result.payload;
      renderDashboard(state.payload);
    } else {
      await loadAndRender();
    }
  } catch {
    showToast(t('demo.page.regenerate_failed'), true);
    // Re-render whatever we had (or fall back to static fixture in demo mode)
    if (state.payload) renderDashboard(state.payload);
    else if (state.isDemo) { state.payload = DEMO_PAYLOAD; renderDashboard(state.payload); }
    else renderPending();
  }
}

// ─── PENDING SCREEN ───────────────────────────────────────────────────────────
function renderPending(showGenerateBtn = false) {
  const wrap = document.getElementById('demo-content');
  if (!wrap) return;

  const genBtn = showGenerateBtn && state.isInternal
    ? `<button class="disc-btn disc-btn--ghost disc-demo-pending__generate" id="js-generate-now">
        ${esc(t('demo.page.generate_now'))}
      </button>`
    : '';

  wrap.innerHTML = `
    <div class="disc-demo-pending">
      <div class="disc-demo-pending__inner">
        <p class="disc-demo-pending__eyebrow">// GENERATING…</p>
        <h2 class="disc-demo-pending__title">${esc(t('demo.page.generating_title'))}</h2>
        <p class="disc-demo-pending__sub">${esc(t('demo.page.generating_sub'))}</p>
        <div class="disc-demo-pending__dots dot-loader" id="js-pending-dots">
          <span></span><span></span><span></span><span></span>
        </div>
        ${genBtn}
      </div>
    </div>
  `;

  if (!RM.matches) {
    const dots = wrap.querySelectorAll('.disc-demo-pending__dots span');
    if (dots.length) {
      animate(dots, {
        opacity: [0.2, 1, 0.2],
        scale: [0.8, 1.1, 0.8],
        duration: 1000,
        ease: 'inOutSine',
        loop: true,
        delay: stagger(160)
      });
    }
  }

  if (showGenerateBtn && state.isInternal) {
    const btn = document.getElementById('js-generate-now');
    if (btn) btn.addEventListener('click', triggerRegenerate);
  }
}

// ─── NEW SECTIONS (admin agent-suite output) ──────────────────────────────────
// Rendered only when present in the payload — backwards compatible with old
// payloads that don't have these fields.

function renderRecommendations(recs) {
  if (!Array.isArray(recs) || recs.length === 0) return '';
  const items = recs.map((r, i) => `
    <li class="disc-demo-recs__item" data-explain-kind="recommendation" data-explain-idx="${i}">
      <span class="disc-demo-recs__n">${String(r.n || '').padStart(2, '0')}</span>
      <div>
        <p class="disc-demo-recs__title">${esc(r.title || '')}</p>
        <p class="disc-demo-recs__body">${esc(r.body || '')}</p>
        <p class="disc-demo-recs__meta">
          ${r.effort    ? `<span class="disc-demo-recs__tag disc-demo-recs__tag--effort-${esc(r.effort)}">effort: ${esc(r.effort)}</span>` : ''}
          ${r.impact    ? `<span class="disc-demo-recs__tag disc-demo-recs__tag--impact-${esc(r.impact)}">impact: ${esc(r.impact)}</span>` : ''}
          ${r.timeframe ? `<span class="disc-demo-recs__tag">${esc(r.timeframe)}</span>` : ''}
        </p>
      </div>
    </li>
  `).join('');
  return `
    <section class="disc-demo-recs" aria-label="Recommendations">
      <div class="disc-demo-recs__head">
        <p class="disc-demo-recs__eye">// 10 RECOMMENDATIONS</p>
        <p class="disc-demo-recs__sub">Ordered by impact × ease — start at #01</p>
      </div>
      <ol class="disc-demo-recs__list">${items}</ol>
    </section>
  `;
}

function renderRisks(risks) {
  if (!Array.isArray(risks) || risks.length === 0) return '';
  const items = risks.map((r, i) => `
    <li class="disc-demo-risks__item disc-demo-risks__item--${esc(r.severity || 'medium')}" data-explain-kind="risk" data-explain-idx="${i}">
      <div class="disc-demo-risks__sev" aria-label="Severity ${esc(r.severity || 'medium')}">${esc(r.severity || 'medium')}</div>
      <div>
        <p class="disc-demo-risks__risk">${esc(r.risk || '')}</p>
        <p class="disc-demo-risks__mit"><strong>Mitigation:</strong> ${esc(r.mitigation || '')}</p>
      </div>
    </li>
  `).join('');
  return `
    <section class="disc-demo-risks" aria-label="Risks">
      <div class="disc-demo-risks__head">
        <p class="disc-demo-risks__eye">// RISKS YOU SHOULD KNOW</p>
        <p class="disc-demo-risks__sub">Honest look at what could derail this</p>
      </div>
      <ul class="disc-demo-risks__list">${items}</ul>
    </section>
  `;
}

function renderRoadmap(road) {
  if (!Array.isArray(road) || road.length === 0) return '';
  const items = road.map((m, i) => `
    <li class="disc-demo-road__item" data-explain-kind="roadmap" data-explain-idx="${i}">
      <span class="disc-demo-road__week">Week ${esc(String(m.week ?? '?'))}</span>
      <div>
        <p class="disc-demo-road__milestone">${esc(m.milestone || '')}</p>
        ${m.owner ? `<p class="disc-demo-road__owner">// ${esc(m.owner)}</p>` : ''}
      </div>
    </li>
  `).join('');
  return `
    <section class="disc-demo-road" aria-label="12-week roadmap">
      <div class="disc-demo-road__head">
        <p class="disc-demo-road__eye">// 12-WEEK ROADMAP</p>
        <p class="disc-demo-road__sub">From kickoff to your target metric</p>
      </div>
      <ol class="disc-demo-road__list">${items}</ol>
    </section>
  `;
}

// Render any ad-hoc sections added via the section_manager agent.
// Each entry: { id, title, type: 'list'|'cards'|'text'|'metric_row', items: [...] }
function renderCustomSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return '';
  return sections.map(s => {
    if (!s || !s.id) return '';
    const items = Array.isArray(s.items) ? s.items : [];
    switch (s.type) {
      case 'list':
        return `<section class="disc-demo-custom disc-demo-custom--list" aria-label="${esc(s.title || s.id)}">
          <p class="disc-demo-custom__eye">// ${esc(String(s.title || s.id).toUpperCase())}</p>
          <ul class="disc-demo-custom__list">
            ${items.map(it => `<li>
              <p class="disc-demo-custom__item-label">${esc(it.label || '')}</p>
              ${it.body ? `<p class="disc-demo-custom__item-body">${esc(it.body)}</p>` : ''}
            </li>`).join('')}
          </ul>
        </section>`;
      case 'cards':
        return `<section class="disc-demo-custom disc-demo-custom--cards" aria-label="${esc(s.title || s.id)}">
          <p class="disc-demo-custom__eye">// ${esc(String(s.title || s.id).toUpperCase())}</p>
          <div class="disc-demo-custom__cards">
            ${items.map(it => `<div class="disc-demo-custom__card">
              <p class="disc-demo-custom__card-title">${esc(it.title || '')}</p>
              <p class="disc-demo-custom__card-body">${esc(it.body || '')}</p>
            </div>`).join('')}
          </div>
        </section>`;
      case 'text':
        return `<section class="disc-demo-custom disc-demo-custom--text" aria-label="${esc(s.title || s.id)}">
          <p class="disc-demo-custom__eye">// ${esc(String(s.title || s.id).toUpperCase())}</p>
          <p class="disc-demo-custom__prose">${esc(items[0]?.body || '')}</p>
        </section>`;
      case 'metric_row':
        return `<section class="disc-demo-custom disc-demo-custom--metric-row" aria-label="${esc(s.title || s.id)}">
          <p class="disc-demo-custom__eye">// ${esc(String(s.title || s.id).toUpperCase())}</p>
          <div class="disc-demo-custom__metrics">
            ${items.map(it => `<div class="disc-demo-custom__metric">
              <span class="disc-demo-custom__metric-k">${esc(it.k || '')}</span>
              <span class="disc-demo-custom__metric-v">${esc(it.v || '')}</span>
            </div>`).join('')}
          </div>
        </section>`;
      default:
        return '';
    }
  }).join('');
}

function renderROI(roi) {
  if (!roi || typeof roi !== 'object') return '';
  return `
    <section class="disc-demo-roi" aria-label="ROI" data-explain-kind="roi" data-explain-idx="0">
      <div class="disc-demo-roi__head">
        <p class="disc-demo-roi__eye">// ANNUAL ROI</p>
      </div>
      <div class="disc-demo-roi__grid">
        <div><span class="disc-demo-roi__k">Hours/week saved</span><span class="disc-demo-roi__v">${esc(String(roi.weekly_hours_saved ?? '—'))}</span></div>
        <div><span class="disc-demo-roi__k">Annual hours saved</span><span class="disc-demo-roi__v">${esc(String(roi.annual_hours_saved ?? '—'))}</span></div>
        <div><span class="disc-demo-roi__k">Annual savings</span><span class="disc-demo-roi__v">$${esc(String(roi.annual_savings_usd ?? '—'))}</span></div>
        <div><span class="disc-demo-roi__k">Payback</span><span class="disc-demo-roi__v">${esc(String(roi.payback_months ?? '—'))} mo</span></div>
      </div>
      ${roi.explanation ? `<p class="disc-demo-roi__explain">${esc(roi.explanation)}</p>` : ''}
    </section>
  `;
}

// ─── DASHBOARD RENDER ─────────────────────────────────────────────────────────
// Helper — sections honor "explicitly emptied" (null / empty array / empty object).
// section_manager.md uses this to hide built-in sections on demand.
function hasContent(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}

function renderDashboard(payload) {
  const p = payload;
  const wrap = document.getElementById('demo-content');
  if (!wrap) return;
  const internal = state.isInternal;

  // Each built-in section can be HIDDEN by setting its field to [] or {} via
  // the section_manager agent ("remove the activity section" → patch.activity=[]).
  const showKpis        = hasContent(p.kpis);
  const showChart       = hasContent(p.chart) && (Array.isArray(p.chart.data) ? p.chart.data.length > 0 : true);
  const showInsights    = hasContent(p.insights);
  const showActivity    = hasContent(p.activity);
  const showCapability  = hasContent(p.capability);
  const showPricing     = hasContent(p.pricing);

  // ── KPI tiles ──────────────────────────────────────────────────────────────
  const kpiTiles = showKpis ? p.kpis.map((kpi, i) => `
    <article class="disc-demo-kpi" aria-label="${esc(kpi.label)}"
      data-explain-kind="kpi" data-explain-idx="${i}">
      <span class="disc-demo-kpi__info" aria-hidden="true" title="Hover for explanation">?</span>
      <p class="disc-demo-kpi__label">${editNode(kpi.label, `kpis.${i}.label`)}</p>
      <p class="disc-demo-kpi__value">${editNode(kpi.value, `kpis.${i}.value`)}</p>
      <p class="disc-demo-kpi__delta">${editNode(kpi.delta, `kpis.${i}.delta`)}</p>
      <p class="disc-demo-kpi__context">${editNode(kpi.context, `kpis.${i}.context`)}</p>
    </article>
  `).join('') : '';

  // ── Chart ──────────────────────────────────────────────────────────────────
  const chartSVG = showChart ? buildChartFromPayload(p.chart) : '';

  // ── Insights ───────────────────────────────────────────────────────────────
  const insightItems = showInsights ? p.insights.map((ins, i) => `
    <div class="disc-demo-dash__insight" data-explain-kind="insight" data-explain-idx="${i}">
      <p class="disc-demo-dash__insight-headline">${editNode(ins.headline, `insights.${i}.headline`)}</p>
      <p class="disc-demo-dash__insight-body">${editNode(ins.body, `insights.${i}.body`)}</p>
    </div>
  `).join('') : '';

  // ── Activity rows ──────────────────────────────────────────────────────────
  const activityRows = showActivity ? p.activity.map((row, i) => `
    <div class="disc-demo-dash__activity-row" role="row">
      <span class="disc-demo-dash__activity-cell disc-demo-dash__activity-cell--when">${editNode(row.when, `activity.${i}.when`)}</span>
      <span class="disc-demo-dash__activity-cell disc-demo-dash__activity-cell--event">${editNode(row.event, `activity.${i}.event`)}</span>
      <span class="disc-demo-dash__activity-cell disc-demo-dash__activity-cell--owner">${editNode(row.owner, `activity.${i}.owner`)}</span>
      <span class="disc-demo-dash__activity-cell disc-demo-dash__activity-cell--value">${editNode(row.value, `activity.${i}.value`)}</span>
    </div>
  `).join('') : '';

  // ── Regenerate button (internal only) ─────────────────────────────────────
  const regenBtn = internal
    ? `<div class="disc-demo-dash__regenerate-wrap">
        <button class="disc-demo-dash__regenerate" id="js-dash-regen">
          ${esc(t('demo.page.regenerate'))}
        </button>
      </div>`
    : '';

  wrap.innerHTML = `
    <div class="disc-demo-dash${internal ? ' is-internal' : ''}">

      <!-- HEADER -->
      <header class="disc-demo-dash__header">
        <div class="disc-demo-dash__header-left">
          <p class="disc-demo-dash__sector-eye">${esc(p.sector_label)}</p>
          <p class="disc-demo-dash__company">${editNode(p.company, 'company')}</p>
          <h1 class="disc-demo-dash__headline">${editNode(p.headline, 'headline', 'span')}</h1>
        </div>
        <div class="disc-demo-dash__header-right">
          <p class="disc-demo-dash__prepared-label">${esc(t('demo.page.prepared_for'))}</p>
          <p class="disc-demo-dash__prepared-name">${editNode(p.prospect_name, 'prospect_name')}</p>
        </div>
      </header>

      ${showKpis ? `
      <!-- KPI STRIP -->
      <section class="disc-demo-dash__kpis" aria-label="Key performance indicators">
        ${kpiTiles}
      </section>
      ` : ''}

      ${(showChart || showInsights) ? `
      <!-- CHART + INSIGHTS -->
      <section class="disc-demo-dash__main" aria-label="Projection and insights">
        ${showChart ? `
        <div class="disc-demo-dash__chart-card">
          <p class="disc-demo-dash__chart-title">${editNode(p.chart.title, 'chart.title')}</p>
          <p class="disc-demo-dash__chart-subtitle">${editNode(p.chart.subtitle, 'chart.subtitle')}</p>
          <div class="disc-demo-dash__chart-wrap" aria-label="Projected weekly close time over 12 weeks">
            ${chartSVG}
            <p class="disc-demo-dash__chart-ylabel">${esc(p.chart.y_label || '')}</p>
          </div>
        </div>` : ''}

        ${showInsights ? `
        <div class="disc-demo-dash__insights-card">
          <div class="disc-demo-dash__insights-head">
            <p class="disc-demo-dash__insights-eye">${esc(t('demo.page.ai_insights'))}</p>
            <p class="disc-demo-dash__insights-sub">${esc(t('demo.page.ai_insights_sub'))}</p>
          </div>
          <div class="disc-demo-dash__insights-list">
            ${insightItems}
          </div>
        </div>` : ''}
      </section>
      ` : ''}

      ${showActivity ? `
      <!-- ACTIVITY TABLE -->
      <section class="disc-demo-dash__activity-card" aria-label="Recent activity">
        <div class="disc-demo-dash__activity-head">
          <p class="disc-demo-dash__activity-eye">${esc(t('demo.page.recent_activity'))}</p>
          <p class="disc-demo-dash__activity-meta">${esc(t('demo.page.last_5_events'))}</p>
        </div>
        <div class="disc-demo-dash__activity-table" role="table" aria-label="Activity log">
          <div class="disc-demo-dash__activity-header" role="row">
            <span role="columnheader">${esc(t('demo.page.col_date'))}</span>
            <span role="columnheader">${esc(t('demo.page.col_event'))}</span>
            <span role="columnheader">${esc(t('demo.page.col_owner'))}</span>
            <span role="columnheader">${esc(t('demo.page.col_value'))}</span>
          </div>
          ${activityRows}
        </div>
        <p class="disc-demo-dash__activity-footer">${esc(t('demo.page.most_recent_first'))}</p>
      </section>
      ` : ''}

      ${(showCapability || showPricing) ? `
      <!-- CAPABILITY + PRICING -->
      <section class="disc-demo-dash__bottom" aria-label="Capability and pricing">

        ${showCapability ? `
        <div class="disc-demo-dash__cap-card">
          <p class="disc-demo-dash__cap-eye">${esc(t('demo.page.recommended'))}</p>
          <p class="disc-demo-dash__cap-code">${editNode(p.capability.code || '', 'capability.code')}</p>
          <p class="disc-demo-dash__cap-label">${editNode(p.capability.label || '', 'capability.label')}</p>
          <p class="disc-demo-dash__cap-why">${editNode(p.capability.why || '', 'capability.why')}</p>
        </div>` : ''}

        ${showPricing ? `
        <div class="disc-demo-dash__pricing-card">
          <p class="disc-demo-dash__pricing-eye">${esc(t('demo.page.your_pricing'))}</p>
          <p class="disc-demo-dash__pricing-tier">${editNode(p.pricing.tier || '', 'pricing.tier')}</p>
          <p class="disc-demo-dash__pricing-headline">${editNode(p.pricing.headline || '', 'pricing.headline')}</p>
          <p class="disc-demo-dash__pricing-sub">${editNode(p.pricing.sub || '', 'pricing.sub')}</p>
          <a href="/#pricing" target="_blank" rel="noopener"
            class="disc-btn disc-btn--primary disc-demo-dash__pricing-cta">
            ${esc(t('demo.page.cta'))}
          </a>
        </div>` : ''}

      </section>
      ` : ''}

      ${renderRecommendations(p.recommendations)}
      ${renderRisks(p.risks)}
      ${renderRoadmap(p.roadmap)}
      ${renderROI(p.roi)}
      ${renderCustomSections(p.custom_sections)}

      ${regenBtn}

    </div>
  `;

  bindEditables(wrap);

  if (internal) {
    const regenEl = document.getElementById('js-dash-regen');
    if (regenEl) regenEl.addEventListener('click', triggerRegenerate);
  }

  runEntranceAnimations(wrap);
  bindExplainHovers(wrap);
}

// ─── METRIC EXPLAIN TOOLTIPS ──────────────────────────────────────────────────
// On hover over an element marked with `data-explain-kind`, fetch a short
// haiku-generated explanation and show it in a tooltip. Cached per (kind+idx)
// so a second hover is instant.
const _explainCache = new Map(); // key: `${kind}:${idx}` → {what, why}
let _explainHoverTimer = null;
let _explainTooltip = null;

function bindExplainHovers(wrap) {
  const targets = wrap.querySelectorAll('[data-explain-kind]');
  console.log(`[explain] binding ${targets.length} hover targets`);
  targets.forEach(el => {
    el.addEventListener('mouseenter', () => scheduleExplain(el));
    el.addEventListener('mouseleave', () => { clearTimeout(_explainHoverTimer); /* keep tooltip if pinned */ if (!_explainTooltip?.classList?.contains('is-pinned')) hideExplainTooltip(); });
    el.addEventListener('focusin',  () => scheduleExplain(el));
    el.addEventListener('focusout', () => { if (!_explainTooltip?.classList?.contains('is-pinned')) hideExplainTooltip(); });
    // Click = INSTANT explain (no hover delay) + pin the tooltip until next click
    el.addEventListener('click', (e) => {
      // Don't hijack clicks on edit affordances inside the tile
      if (e.target.closest('.disc-demo-dash__editable, button, a, input, textarea')) return;
      e.preventDefault();
      clearTimeout(_explainHoverTimer);
      showExplainTooltip(el, true);
    });
  });
  // Global click — clicking outside the tooltip closes it
  if (!document._explainOutsideBound) {
    document._explainOutsideBound = true;
    document.addEventListener('click', (e) => {
      if (!_explainTooltip?.classList?.contains('is-pinned')) return;
      if (e.target.closest('.disc-explain') || e.target.closest('[data-explain-kind]')) return;
      hideExplainTooltip();
    });
  }
}

function scheduleExplain(el) {
  clearTimeout(_explainHoverTimer);
  _explainHoverTimer = setTimeout(() => showExplainTooltip(el), 200);
}

async function showExplainTooltip(el, pinned = false) {
  const kind = el.dataset.explainKind;
  const idx  = parseInt(el.dataset.explainIdx || '0', 10);
  const cacheKey = `${kind}:${idx}`;
  const item = pickPayloadItem(kind, idx);
  if (!item) { console.warn('[explain] no payload item for', kind, idx); return; }

  ensureTooltipEl();
  positionTooltip(el);
  _explainTooltip.classList.toggle('is-pinned', pinned);
  // Loading state
  _explainTooltip.innerHTML = `<div class="disc-explain__loading">…</div>`;
  _explainTooltip.classList.add('is-visible');

  if (_explainCache.has(cacheKey)) {
    renderTooltip(_explainCache.get(cacheKey));
    return;
  }

  console.log('[explain] fetching', kind, idx);
  try {
    const token = state.token;
    const r = await fetch(`/api/discovery/demo/explain-metric`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token, kind, payload: item })
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status} ${errBody.slice(0, 100)}`);
    }
    const data = await r.json();
    _explainCache.set(cacheKey, data);
    // Only render if mouse still over the same element (tooltip still visible)
    if (_explainTooltip.classList.contains('is-visible')) {
      renderTooltip(data);
    }
  } catch (e) {
    console.error('[explain] fetch failed', e);
    if (_explainTooltip.classList.contains('is-visible')) {
      _explainTooltip.innerHTML = `<div class="disc-explain__err">Couldn't load explanation: ${esc(e.message)}</div>`;
    }
  }
}

function pickPayloadItem(kind, idx) {
  const p = state.payload;
  if (!p) return null;
  switch (kind) {
    case 'kpi':            return p.kpis?.[idx];
    case 'insight':        return p.insights?.[idx];
    case 'risk':           return p.risks?.[idx];
    case 'recommendation': return p.recommendations?.[idx];
    case 'roadmap':        return p.roadmap?.[idx];
    case 'roi':            return p.roi;
    default:               return null;
  }
}

function ensureTooltipEl() {
  if (_explainTooltip) return;
  _explainTooltip = document.createElement('div');
  _explainTooltip.className = 'disc-explain';
  _explainTooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(_explainTooltip);
}

function positionTooltip(anchorEl) {
  // position: fixed so the tooltip lives in the viewport (works inside iframes
  // without getting clipped by scroll containers). Clamp so it never overflows
  // the viewport edges — pick above-or-below based on available space.
  const TT_W = 320, TT_H_ESTIMATE = 140, MARGIN = 8;
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;

  // Prefer below the element; flip above if not enough room
  const spaceBelow = vh - rect.bottom;
  const showBelow  = spaceBelow > TT_H_ESTIMATE + MARGIN || spaceBelow > vh - rect.top;
  const top = showBelow
    ? Math.min(rect.bottom + 6, vh - TT_H_ESTIMATE - MARGIN)
    : Math.max(MARGIN, rect.top - TT_H_ESTIMATE - 6);
  const left = Math.min(Math.max(MARGIN, rect.left), vw - TT_W - MARGIN);
  _explainTooltip.style.position = 'fixed';
  _explainTooltip.style.top  = `${top}px`;
  _explainTooltip.style.left = `${left}px`;
  _explainTooltip.style.width = `${TT_W}px`;
}

function renderTooltip(data) {
  if (!_explainTooltip) return;
  _explainTooltip.innerHTML = `
    <p class="disc-explain__eye">// WHAT IT MEANS</p>
    <p class="disc-explain__what">${esc(data.what || '')}</p>
    <p class="disc-explain__eye">// WHY WE PICKED IT</p>
    <p class="disc-explain__why">${esc(data.why || '')}</p>
  `;
}

function hideExplainTooltip() {
  if (_explainTooltip) _explainTooltip.classList.remove('is-visible');
}

// ─── ENTRANCE ANIMATIONS ──────────────────────────────────────────────────────
function runEntranceAnimations(wrap) {
  if (RM.matches) return;

  // KPI tiles stagger
  const kpis = wrap.querySelectorAll('.disc-demo-kpi');
  if (kpis.length) {
    animate(kpis, {
      opacity: [0, 1],
      translateY: [12, 0],
      duration: 480,
      ease: 'outCubic',
      delay: stagger(70)
    });
  }

  // Chart line draw
  const chartLine = wrap.querySelector('.disc-demo-dash__chart-line');
  if (chartLine) {
    const pathLen = parseFloat(chartLine.dataset.pathLen) || 600;
    chartLine.style.strokeDashoffset = pathLen;
    animate(chartLine, {
      strokeDashoffset: [pathLen, 0],
      duration: 900,
      ease: 'inOutSine',
      delay: 400
    });
  }

  // Insights fade in
  const insights = wrap.querySelectorAll('.disc-demo-dash__insight');
  if (insights.length) {
    animate(insights, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 400,
      ease: 'outCubic',
      delay: stagger(80, { start: 300 })
    });
  }
}

// ─── SHELL RENDER (sticky bar + content wrapper) ───────────────────────────────
function renderShell(company) {
  const root = document.getElementById('root');
  if (!root) return;

  const profileUrl = esc(getProfileUrl());
  const backLabel   = esc(t('demo.page.back'));
  const eyebrow     = esc(t('demo.page.eyebrow', { company }));
  const ctaLabel    = esc(t('demo.page.cta'));
  const footer      = esc(t('demo.page.footer'));

  const editBadge = state.isInternal
    ? `<span class="disc-demo-page__bar-badge disc-demo-page__bar-badge--edit" aria-label="Edit mode active">
        ${esc(t('demo.page.edit_mode_badge'))}
        <i class="disc-demo-page__bar-badge-dot" aria-hidden="true"></i>
      </span>`
    : '';

  root.innerHTML = `
    <div class="disc-demo-page">

      <div class="disc-demo-page__bar" role="banner" aria-label="Demo navigation">
        <div class="disc-demo-page__bar-left">
          <a href="${profileUrl}" class="disc-demo-page__back">${backLabel}</a>
          <p class="disc-demo-page__eyebrow">${eyebrow}</p>
        </div>
        <div class="disc-demo-page__bar-right">
          ${editBadge}
          <a href="/#pricing" target="_blank" rel="noopener"
            class="disc-btn disc-btn--primary disc-demo-page__bar-cta">
            ${ctaLabel}
          </a>
        </div>
      </div>

      <main id="demo-content" class="disc-demo-page__content">
        <!-- payload rendered here -->
      </main>

      <footer class="disc-demo-page__footer" aria-label="Demo disclaimer">
        <p>${footer}</p>
      </footer>

    </div>
  `;
}

// ─── LOAD AND RENDER ──────────────────────────────────────────────────────────
// safeRender: wraps renderDashboard so a runtime exception (e.g. a malformed
// payload field after an admin edit) doesn't leave the page stuck on the
// pending state with no diagnostic. Logs the real error to console so the
// admin can debug from DevTools.
function safeRender(payload) {
  try {
    // Re-render the shell now that we know the prospect's real name —
    // initial render at init() didn't have the payload yet so it fell back
    // to the magic_token in the URL.
    const friendly = payload?.prospect_name || payload?.company || (state.isDemo ? DEMO_PAYLOAD.company : null);
    if (friendly) renderShell(friendly);
    renderDashboard(payload);
  } catch (err) {
    console.error('[demo-preview] renderDashboard threw:', err);
    const wrap = document.getElementById('demo-content');
    if (wrap) {
      wrap.innerHTML = `
        <div class="disc-demo-pending">
          <div class="disc-demo-pending__inner">
            <p class="disc-demo-pending__eyebrow">// RENDER ERROR</p>
            <h2 class="disc-demo-pending__title">Couldn't render the dashboard.</h2>
            <p class="disc-demo-pending__sub" style="color:#fca5a5;font-family:var(--font-mono);font-size:12px;max-width:560px;word-break:break-word;">
              ${esc(String(err?.message || err))}
            </p>
            ${state.isInternal ? `
              <button class="disc-btn disc-btn--ghost disc-demo-pending__generate" id="js-generate-now">
                Regenerate from scratch →
              </button>
            ` : ''}
          </div>
        </div>
      `;
      const btn = document.getElementById('js-generate-now');
      if (btn) btn.addEventListener('click', triggerRegenerate);
    }
  }
}

async function loadAndRender() {
  if (state.isDemo) {
    try {
      const data = await api(`/demo?token=demo`);
      if (data.status === 'ready' && data.payload) {
        state.payload = data.payload;
        safeRender(state.payload);
        return;
      }
    } catch {}
    state.payload = DEMO_PAYLOAD;
    safeRender(state.payload);
    return;
  }

  // Live mode: fetch from API. Cache-bust the request so an iframe reload
  // after a fresh regen never reads a stale cached response.
  // Retry once on `status: 'pending'` with a 1.5s back-off — covers the
  // brief window between admin-side dashboard-generate finishing its upsert
  // and the prospect-side demo endpoint seeing the row.
  renderPending(false);
  const fetchDemo = async () => {
    const buster = Date.now();
    const data = await api(`/demo?token=${encodeURIComponent(state.token)}&_t=${buster}`);
    console.info('[demo-preview] /demo →', data?.status, data?.payload ? '(has payload)' : '(no payload)', data?.generated_at || '');
    return data;
  };
  try {
    let data = await fetchDemo();
    if (data.status === 'pending') {
      console.info('[demo-preview] pending, retrying in 1.5s…');
      await new Promise(r => setTimeout(r, 1500));
      data = await fetchDemo();
    }
    if (data.status === 'ready' && data.payload) {
      state.payload = data.payload;
      safeRender(state.payload);
    } else {
      console.warn('[demo-preview] still pending or no payload after retry — showing pending state');
      renderPending(state.isInternal);
    }
  } catch (err) {
    console.error('[demo-preview] /demo fetch failed:', err);
    renderPending(state.isInternal);
  }
}

// ─── CHAT WIDGET ──────────────────────────────────────────────────────────────

// Lucide SVG icons (square stroke, 20px)
const ICON_CHAT = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"
  aria-hidden="true" focusable="false">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
</svg>`;

const ICON_X = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"
  aria-hidden="true" focusable="false">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

const ICON_ARROW_UP = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"
  aria-hidden="true" focusable="false">
  <line x1="12" y1="19" x2="12" y2="5"/>
  <polyline points="5 12 12 5 19 12"/>
</svg>`;

function chatFmtTime(ts) {
  const d = new Date(ts);
  return `// ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function chatMsgHtml(msg) {
  const roleClass = msg.role === 'user'
    ? 'disc-demo-chat-msg--user'
    : 'disc-demo-chat-msg--assistant';
  return `
    <div class="disc-demo-chat-msg ${roleClass}">
      <span class="disc-demo-chat-msg__ts">${chatFmtTime(msg.ts)}</span>
      <div class="disc-demo-chat-msg__body">${esc(msg.content)}</div>
    </div>`;
}

function chatPendingHtml() {
  const ts = chatFmtTime(Date.now());
  return `
    <div class="disc-demo-chat-msg disc-demo-chat-msg--assistant disc-demo-chat-msg--pending" id="js-chat-pending">
      <span class="disc-demo-chat-msg__ts">${ts}</span>
      <div class="disc-demo-chat-msg__body">
        <span class="disc-demo-chat-msg__dot"></span>
        <span class="disc-demo-chat-msg__dot"></span>
        <span class="disc-demo-chat-msg__dot"></span>
      </div>
    </div>`;
}

function chatErrorHtml() {
  return `
    <div class="disc-demo-chat-error" id="js-chat-error">
      <div class="disc-demo-chat-error__msg">${esc(t('demo.chat.error'))}</div>
      <button class="disc-demo-chat-error__retry" id="js-chat-retry"
        type="button">Retry</button>
    </div>`;
}

function renderChatMessages(listEl) {
  listEl.innerHTML = '';
  for (const msg of state.chat.messages) {
    listEl.insertAdjacentHTML('beforeend', chatMsgHtml(msg));
  }
  if (state.chat.pending) {
    listEl.insertAdjacentHTML('beforeend', chatPendingHtml());
  }
  if (state.chat.error) {
    listEl.insertAdjacentHTML('beforeend', chatErrorHtml());
    const retryBtn = listEl.querySelector('#js-chat-retry');
    if (retryBtn) retryBtn.addEventListener('click', chatRetry);
  }
  // Auto-scroll to bottom
  listEl.scrollTop = listEl.scrollHeight;
}

let _chatRetryQuestion = '';

async function chatSend(question, listEl, inputEl, sendBtn) {
  if (!question.trim() || state.chat.pending) return;

  _chatRetryQuestion = question.trim();
  state.chat.error = null;

  // Append user message
  state.chat.messages.push({ role: 'user', content: question.trim(), ts: Date.now() });
  state.chat.pending = true;
  if (inputEl) { inputEl.value = ''; inputEl.style.height = ''; }
  if (sendBtn) sendBtn.disabled = true;
  renderChatMessages(listEl);

  // Build history (all but the last user turn we just added)
  const history = state.chat.messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

  try {
    const data = await fetch(`/api/discovery/demo/ask?token=${encodeURIComponent(state.token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ question: question.trim(), history })
    }).then(r => r.json());

    state.chat.pending = false;
    if (data?.answer) {
      state.chat.messages.push({ role: 'assistant', content: data.answer, ts: Date.now() });
    } else {
      state.chat.error = true;
    }
  } catch {
    state.chat.pending = false;
    state.chat.error = true;
  }

  if (sendBtn) sendBtn.disabled = false;
  renderChatMessages(listEl);
}

async function chatRetry() {
  const panel = document.getElementById('js-chat-panel');
  if (!panel) return;
  const listEl  = panel.querySelector('.disc-demo-chat-panel__messages');
  const inputEl = panel.querySelector('.disc-demo-chat-panel__input');
  const sendBtn = panel.querySelector('.disc-demo-chat-panel__send');
  if (listEl) await chatSend(_chatRetryQuestion, listEl, inputEl, sendBtn);
}

function buildChatPanel() {
  const prospectName = state.payload?.prospect_name || 'there';
  const company      = state.payload?.company       || 'your company';
  const introMsg = t('demo.chat.intro', { name: prospectName, company });

  // Inject intro message only once
  if (state.chat.messages.length === 0) {
    state.chat.messages.push({ role: 'assistant', content: introMsg, ts: Date.now() });
  }

  const panel = document.createElement('div');
  panel.className = 'disc-demo-chat-panel';
  panel.id = 'js-chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('demo.chat.title'));
  panel.setAttribute('aria-modal', 'true');

  panel.innerHTML = `
    <div class="disc-demo-chat-panel__header">
      <div class="disc-demo-chat-panel__header-row">
        <p class="disc-demo-chat-panel__title">${esc(t('demo.chat.title'))}</p>
        <button class="disc-demo-chat-panel__close" id="js-chat-close"
          type="button" aria-label="${esc(t('demo.chat.close'))}">${ICON_X}</button>
      </div>
      <p class="disc-demo-chat-panel__sub">${esc(t('demo.chat.sub'))}</p>
    </div>
    <div class="disc-demo-chat-panel__messages" id="js-chat-messages" aria-live="polite" aria-relevant="additions"></div>
    <div class="disc-demo-chat-panel__input-bar">
      <div class="disc-demo-chat-panel__chips" id="js-chat-chips">
        <button class="disc-demo-chat-panel__chip" type="button">${esc(t('demo.chat.suggestion_1'))}</button>
        <button class="disc-demo-chat-panel__chip" type="button">${esc(t('demo.chat.suggestion_2'))}</button>
        <button class="disc-demo-chat-panel__chip" type="button">${esc(t('demo.chat.suggestion_3'))}</button>
      </div>
      <div class="disc-demo-chat-panel__input-row">
        <textarea
          class="disc-demo-chat-panel__input"
          id="js-chat-input"
          rows="1"
          placeholder="${esc(t('demo.chat.placeholder'))}"
          aria-label="${esc(t('demo.chat.placeholder'))}"
          maxlength="500"></textarea>
        <button class="disc-demo-chat-panel__send" id="js-chat-send"
          type="button" aria-label="${esc(t('demo.chat.send'))}">${ICON_ARROW_UP}</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  const listEl  = panel.querySelector('#js-chat-messages');
  const inputEl = panel.querySelector('#js-chat-input');
  const sendBtn = panel.querySelector('#js-chat-send');
  const closeBtn = panel.querySelector('#js-chat-close');

  // Render initial messages
  renderChatMessages(listEl);

  // Close button
  closeBtn.addEventListener('click', chatClose);

  // Send on button click
  sendBtn.addEventListener('click', () => {
    chatSend(inputEl.value, listEl, inputEl, sendBtn);
  });

  // Send on Enter (Shift+Enter = newline)
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatSend(inputEl.value, listEl, inputEl, sendBtn);
    }
  });

  // Chip clicks — send question and collapse chips after first use
  const chipsEl = panel.querySelector('#js-chat-chips');
  chipsEl.addEventListener('click', e => {
    const chip = e.target.closest('.disc-demo-chat-panel__chip');
    if (!chip) return;
    const question = chip.textContent.trim();
    chatSend(question, listEl, inputEl, sendBtn);
    // Collapse chips after first use
    chipsEl.style.display = 'none';
  });

  // ESC closes
  panel._onKeydown = e => {
    if (e.key === 'Escape') chatClose();
  };
  document.addEventListener('keydown', panel._onKeydown);

  // Click-outside closes (only when not actively in the input)
  panel._onPointerDown = e => {
    if (!panel.contains(e.target) && document.activeElement !== inputEl) {
      chatClose();
    }
  };
  // Defer so the open-click doesn't immediately close
  setTimeout(() => {
    document.addEventListener('pointerdown', panel._onPointerDown);
  }, 100);

  // Focus input
  inputEl.focus();

  // Mobile: lock body scroll
  if (window.innerWidth <= 820) {
    document.body.classList.add('disc-chat-open');
  }
}

function chatOpen() {
  if (state.chat.open) return;
  state.chat.open = true;
  state.chat.everOpened = true;

  // Stop pulse dot
  const fab = document.getElementById('js-chat-fab');
  if (fab) fab.classList.remove('disc-demo-chat-fab--has-unseen');

  buildChatPanel();
}

function chatClose() {
  if (!state.chat.open) return;
  state.chat.open = false;

  const panel = document.getElementById('js-chat-panel');
  if (panel) {
    document.removeEventListener('keydown', panel._onKeydown);
    document.removeEventListener('pointerdown', panel._onPointerDown);
    panel.remove();
  }

  document.body.classList.remove('disc-chat-open');

  // Return focus to FAB
  const fab = document.getElementById('js-chat-fab');
  if (fab) fab.focus();
}

function mountChatFab() {
  // Only mount on the demo page (not profile page)
  const isDemoPage = /\/discovery\/p\/[^/?#]+\/demo/.test(location.pathname);
  if (!isDemoPage) return;

  const fab = document.createElement('button');
  fab.className = 'disc-demo-chat-fab disc-demo-chat-fab--has-unseen';
  fab.id = 'js-chat-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', t('demo.chat.fab_aria'));
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML = `${ICON_CHAT}<span class="disc-demo-chat-fab__dot" aria-hidden="true"></span>`;

  fab.addEventListener('click', () => {
    if (state.chat.open) {
      chatClose();
      fab.setAttribute('aria-expanded', 'false');
    } else {
      chatOpen();
      fab.setAttribute('aria-expanded', 'true');
    }
  });

  document.body.appendChild(fab);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  state.token      = getToken();
  state.isDemo     = isDemo();
  state.isInternal = isInternal();

  // When loaded inside the admin iframe (?internal=1) we hide the Arqentia
  // brand header — its position:sticky makes it follow the iframe scroll
  // and visually duplicates the admin's own topbar.
  if (state.isInternal) {
    document.body.classList.add('disc-shell--embedded');
  }

  // ── ADMIN-ONLY GATE ──────────────────────────────────────────────────────
  // The personalized demo is a sales/review tool for Arqentia leadership, not
  // a prospect deliverable. Block anyone who isn't an admin (no admin cookie
  // AND no ?internal=1 query param) — bounce them back to their profile.
  // The static `?demo=1` fixture page is public for marketing purposes — that
  // one still works.
  if (!state.isDemo) {
    const hasAdminCookie = document.cookie.split(';').some(c => c.trim().startsWith('arq_admin='));
    const isInternalView = state.isInternal;
    if (!hasAdminCookie && !isInternalView) {
      // Bounce to the prospect's own profile dashboard
      window.location.replace(`/discovery/p/${encodeURIComponent(state.token || '')}`);
      return;
    }
  }

  // Use a friendly placeholder until the payload loads — never show the
  // magic_token hex as if it were a company name (see issue 2026-05-28).
  const placeholder = state.isDemo
    ? DEMO_PAYLOAD.company
    : (state.language === 'es' ? 'tu dashboard' : 'your dashboard');
  renderShell(placeholder);

  await loadAndRender();

  // Mount the chat FAB after dashboard is rendered so payload is available
  mountChatFab();
}

// ─── LANG CHANGE ─────────────────────────────────────────────────────────────
document.addEventListener('arq:lang', () => {
  const friendly = state.payload?.prospect_name || state.payload?.company
    || (state.language === 'es' ? 'tu dashboard' : 'your dashboard');
  renderShell(friendly);
  if (state.payload) renderDashboard(state.payload);
  else renderPending(state.isInternal);
});

// ─── BOOT ─────────────────────────────────────────────────────────────────────
init();
