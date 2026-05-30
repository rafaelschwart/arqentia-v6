// discovery/admin.js
// Admin view at /arqentia/admin — list + slide-out detail + inline demo preview.
// No auth in dev. Wire ARQ_ADMIN_PASSWORD + cookie before prod.

const state = {
  prospects: [],
  selectedId: null,
  detail: null,
  loading: false,
  filter: { search: '', status: null, sector: null },
  rawOpen: { summary: false, demo: false, answers: false },
  editor: {
    messages: [],    // [{role:'user'|'assistant'|'system', content, ts, specialists?, errors?, images?}]
    pending: false,
    input: '',
    iframeBuster: 0,
    // Pending image attachments for the next send. Each entry:
    //   { name, mediaType, dataUrl, base64 } — dataUrl for preview, base64 for the API
    pendingImages: []
  },
  generating: false,      // true while POST /api/admin/dashboard-generate is in flight
  generateError: null,
  needsLogin: false,      // true → render the login modal in place of everything
  loginPending: false,
  loginError: null,
  magicSent: false,       // true after a magic-link request succeeded
  // API cost telemetry — populated on admin load (overview) and on Costs-button
  // click (per-prospect drill-down).
  usage: null,            // overview payload from GET /api/admin/token-usage
  usageLoading: false,
  costs: {
    open: false,
    scope: 'overview',    // 'overview' | 'prospect'
    prospectId: null,
    data: null,
    loading: false,
    error: null
  },
  // Set by regenerateProspectContent() while a language-regen is in flight.
  // null when nothing is regenerating; { lang, summary, dashboard, startedAt }
  // when work is in progress. Drives the inline loading overlays on the
  // summary card + demo iframe + button spinner.
  regen: null
};

// Quick-action prompts surfaced as chips in the chat panel
// Localized quick prompts — label uses T(), prompt sent to agents is ALWAYS
// English (agents understand both but English is what their prompts expect).
function getQuickPrompts() {
  return [
    { labelKey: 'qp.headline', prompt: 'Rewrite the headline to be sharper and more specific to this prospect.' },
    { labelKey: 'qp.kpis',     prompt: 'Redesign the 6 KPI tiles based on their stated metrics. Keep KPI 1 = their Q8 metric.' },
    { labelKey: 'qp.recs',     prompt: 'Write the 10 recommendations section, ordered by impact × ease.' },
    { labelKey: 'qp.risks',    prompt: 'Identify 4-5 risks/blockers specific to their tools and team size.' },
    { labelKey: 'qp.roadmap',  prompt: 'Build the 12-week roadmap with milestones at weeks 2, 4, 6, 8, 10, 12.' },
    { labelKey: 'qp.roi',      prompt: 'Calculate annual ROI from their stated hours-per-week + a $20/h analyst cost.' },
    { labelKey: 'qp.optims',   prompt: 'Recommend 4-6 process optimizations grounded in their specific tools.' },
    { labelKey: 'qp.insights', prompt: 'Regenerate the 3 insights to reference their tools and numbers more specifically.' },
    { labelKey: 'qp.polish',   prompt: 'Polish the whole dashboard — headline, KPIs, insights, recommendations. Make it screenshottable.' }
  ];
}

const root = document.getElementById('root');

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// ─── ADMIN i18n ────────────────────────────────────────────────────────────
// Persisted to localStorage. Toggled via the EN/ES buttons in the top bar.
const LANG_KEY = 'arq_admin_lang';
function admLang() {
  try { return localStorage.getItem(LANG_KEY) === 'es' ? 'es' : 'en'; } catch { return 'en'; }
}
function setAdmLang(l) {
  try { localStorage.setItem(LANG_KEY, l === 'es' ? 'es' : 'en'); } catch {}
}
const STRINGS = {
  en: {
    'topbar.prospects':       '{n} prospects',
    'topbar.loading':         'Loading…',
    'topbar.logout':          'log out',
    'topbar.spend.label':     'Today',
    'topbar.spend.tooltip':   'API spend today — click for full breakdown',
    'costs.eye':              '// API USAGE',
    'costs.title.overview':   'Token usage & cost',
    'costs.title.prospect':   'Cost for this prospect',
    'costs.subtitle.overview':'Claude + OpenAI spend across all prospects, last 30 days.',
    'costs.close':            'Close',
    'costs.bucket.today':     'Today',
    'costs.bucket.week':      'Last 7 days',
    'costs.bucket.month':     'Last 30 days',
    'costs.bucket.all':       'All time',
    'costs.bucket.all_calls': 'All time',
    'costs.bucket.in_tokens': 'Input tokens',
    'costs.bucket.out_tokens':'Output tokens',
    'costs.bucket.voice_sec': 'Voice duration',
    'costs.daily':            '// DAILY SPEND · LAST 14 DAYS',
    'costs.by_provider':      '// BY PROVIDER',
    'costs.by_model':         '// BY MODEL',
    'costs.by_route':         '// BY ROUTE',
    'costs.top_prospects':    '// TOP SPENDERS · LAST 30 DAYS',
    'costs.recent_calls':     '// RECENT CALLS',
    'costs.col.provider':     'Provider',
    'costs.col.model':        'Model',
    'costs.col.route':        'Route',
    'costs.col.calls':        'Calls',
    'costs.col.tokens':       'Tokens',
    'costs.col.cost':         'Cost',
    'costs.col.when':         'When',
    'costs.col.in':           'In',
    'costs.col.out':          'Out',
    'costs.calls_short':      'calls',
    'costs.tokens_short':     'tok',
    'costs.no_prospects':     'No prospect spending yet.',
    'costs.empty':            'No data in this window.',
    'costs.no_data':          'No usage data.',
    'costs.anonymous':        'Anonymous',
    'costs.migration.eye':    '// MIGRATION NEEDED',
    'costs.migration.heading':'Cost tracking is not yet enabled.',
    'costs.migration.sub':    'Run this migration in Supabase SQL Editor to start capturing per-call token usage and computed USD cost.',
    'list.search_placeholder':'// search name / company / email / sector',
    'list.unclassified':      'Unclassified',
    'list.empty.loading':     '// loading…',
    'list.empty.no_match':    '// no prospects match',
    'chip.all':               'All',
    'chip.completed':         'Completed',
    'chip.started':           'Started',
    'chip.trash':             'Trash',
    'bucket.today':           'Today',
    'bucket.yesterday':       'Yesterday',
    'bucket.week':            'This week',
    'bucket.month':           'This month',
    'bucket.older':           'Older',
    'row.tag.completed':      'completed',
    'row.tag.demo_ready':     'demo ready',
    'row.tag.no_demo':        'no demo',
    'row.tag.trash':          'trash',
    'row.action.restore':     'Restore from trash',
    'row.action.delete_hard': 'Delete permanently',
    'row.action.delete_soft': 'Send to trash',
    'confirm.soft':           'Move this prospect to trash? You can restore them later.',
    'confirm.hard':           'PERMANENTLY delete this prospect AND all their answers, summary, demo, and events? This cannot be undone.',
    'detail.back':            '← Back to list',
    'detail.prospect_view':   'Prospect view ↗',
    'detail.costs':           'API costs',
    'detail.open_demo':       'Open demo full-screen ↗',
    'detail.regen.btn':       '⟳ Regenerate in {lang}',
    'detail.regen.btn_loading':'Regenerating in {lang}…',
    'detail.regen.title':     'This prospect’s summary and dashboard were generated in a different language. Click to regenerate them in the current admin language.',
    'detail.regen.summary_loading':   'Regenerating AI summary in {lang}… (10–25 sec)',
    'detail.regen.dashboard_loading': 'Regenerating personalized dashboard in {lang}… (15–35 sec)',
    'detail.section.summary': '// AI SUMMARY',
    'detail.section.demo':    '// PERSONALIZED DEMO DASHBOARD',
    'detail.section.answers': '// ANSWERS',
    'detail.section.events':  '// EVENT TRAIL',
    'detail.section.notif':   '// NOTIFICATIONS',
    'detail.no_summary':      '// no summary yet',
    'detail.no_demo':         '// no dashboard generated yet',
    'detail.no_demo_sub':     "The prospect's profile has a summary but no personalized demo. Click below to build one with the agent pipeline, then refine it in the editor on the right.",
    'detail.generating':      'Running 7-pass agent pipeline... this takes ~25 seconds.',
    'detail.generate_cta':    'Generate dashboard →',
    'detail.generating_btn':  'Generating…',
    'detail.kv.sector':       'Sector',
    'detail.kv.capability':   'Capability',
    'detail.kv.hrs_saved':    'Hrs/wk saved',
    'detail.kv.payback':      'Payback (mo)',
    'detail.demo.gen_at':     'generated',
    'detail.demo.edited':     'edited',
    'detail.demo.auto':       'auto',
    'editor.title':           '// DASHBOARD EDITOR',
    'editor.model_tag':       'claude · 12-agent suite',
    'editor.empty':           '// describe a change — e.g. "rewrite the headline" — and the agent suite will apply it to the dashboard live',
    'editor.empty.eye':       '// agent suite ready',
    'editor.empty.heading':   'Tell the agents what to change.',
    'editor.empty.sub':       'Try "rewrite the headline mentioning their 38 employees" or "add a section about onboarding." The 12 specialists route automatically.',
    'editor.orchestrating':   'orchestrating agents…',
    'editor.placeholder':     '// tell the agents what to change…',
    'editor.placeholder_img': '// describe what you want fixed in the image…',
    'editor.send':            'Send →',
    'editor.attach':          'Attach image',
    'editor.mainAgent':       'Main agent',
    'admin.lang.regen_prompt':'Regenerate this prospect’s dashboard in the new language? This will overwrite the current edits.',
    'admin.lang.regen_toast': 'Regenerating prospect content in the new language…',
    'admin.lang.regen_done':  'Prospect content regenerated.',
    'admin.lang.regen_error': 'Regeneration failed. Try again or check the console.',
    'empty.detail.eye':       '// no prospect selected',
    'empty.detail.heading':   'Pick someone on the left.',
    'empty.detail.sub':       'Their profile summary, full discovery answers, and the personalized demo dashboard show up here. Edits route through the 12-agent suite.',
    'empty.detail.stat.total':   'Total',
    'empty.detail.stat.demo':    'With demo',
    'empty.detail.stat.pending': 'Pending demo',
    'list.empty.no_prospects.eye':      '// no prospects yet',
    'list.empty.no_prospects.heading':  'Discovery hasn’t kicked off.',
    'list.empty.no_prospects.sub':      'Once someone completes the voice or text intake, they’ll land here grouped by day.',
    'list.empty.filtered.eye':          '// no matches',
    'list.empty.filtered.heading':      'Nothing in this view.',
    'list.empty.filtered.sub':          'Clear the search or switch the status filter to see more.',
    'editor.empty_select':    '// select a prospect on the left to view their summary, answers, and personalized demo dashboard',
    'editor.loading_detail':  '// loading detail…',
    'editor.raw_toggle':      '// raw demo payload JSON',
    // Quick prompts
    'qp.headline':            'Rewrite headline',
    'qp.kpis':                'Redesign KPI tiles',
    'qp.recs':                '10 recommendations',
    'qp.risks':               'Risks they should know',
    'qp.roadmap':             '12-week roadmap',
    'qp.roi':                 'ROI math',
    'qp.optims':              'Process optimizations',
    'qp.insights':            'Redo insights',
    'qp.polish':              'Polish everything',
    'login.eye':              '// ARQENTIA ADMIN',
    'login.redirecting':      'Redirecting to sign-in…'
  },
  es: {
    'topbar.prospects':       '{n} prospectos',
    'topbar.spend.label':     'Hoy',
    'topbar.spend.tooltip':   'Gasto en APIs hoy — clic para ver el desglose',
    'costs.eye':              '// USO DE APIs',
    'costs.title.overview':   'Uso de tokens y costo',
    'costs.title.prospect':   'Costo de este prospecto',
    'costs.subtitle.overview':'Gasto en Claude + OpenAI, últimos 30 días.',
    'costs.close':            'Cerrar',
    'costs.bucket.today':     'Hoy',
    'costs.bucket.week':      'Últimos 7 días',
    'costs.bucket.month':     'Últimos 30 días',
    'costs.bucket.all':       'Total histórico',
    'costs.bucket.all_calls': 'Total histórico',
    'costs.bucket.in_tokens': 'Tokens entrada',
    'costs.bucket.out_tokens':'Tokens salida',
    'costs.bucket.voice_sec': 'Duración voz',
    'costs.daily':            '// GASTO DIARIO · 14 DÍAS',
    'costs.by_provider':      '// POR PROVEEDOR',
    'costs.by_model':         '// POR MODELO',
    'costs.by_route':         '// POR RUTA',
    'costs.top_prospects':    '// MAYOR GASTO · 30 DÍAS',
    'costs.recent_calls':     '// LLAMADAS RECIENTES',
    'costs.col.provider':     'Proveedor',
    'costs.col.model':        'Modelo',
    'costs.col.route':        'Ruta',
    'costs.col.calls':        'Llamadas',
    'costs.col.tokens':       'Tokens',
    'costs.col.cost':         'Costo',
    'costs.col.when':         'Cuándo',
    'costs.col.in':           'Ent',
    'costs.col.out':          'Sal',
    'costs.calls_short':      'llam.',
    'costs.tokens_short':     'tok',
    'costs.no_prospects':     'Sin gasto por prospecto todavía.',
    'costs.empty':            'Sin datos en esta ventana.',
    'costs.no_data':          'Sin datos de uso.',
    'costs.anonymous':        'Anónimo',
    'costs.migration.eye':    '// FALTA MIGRACIÓN',
    'costs.migration.heading':'El tracking de costos aún no está activo.',
    'costs.migration.sub':    'Corre esta migración en el SQL Editor de Supabase para empezar a capturar tokens y costo USD por llamada.',
    'topbar.loading':         'Cargando…',
    'topbar.logout':          'cerrar sesión',
    'list.search_placeholder':'// buscar nombre / empresa / email / sector',
    'list.unclassified':      'Sin clasificar',
    'list.empty.loading':     '// cargando…',
    'list.empty.no_match':    '// ningún prospecto coincide',
    'chip.all':               'Todos',
    'chip.completed':         'Completados',
    'chip.started':           'Iniciados',
    'chip.trash':             'Papelera',
    'bucket.today':           'Hoy',
    'bucket.yesterday':       'Ayer',
    'bucket.week':            'Esta semana',
    'bucket.month':           'Este mes',
    'bucket.older':           'Anteriores',
    'row.tag.completed':      'completado',
    'row.tag.demo_ready':     'demo listo',
    'row.tag.no_demo':        'sin demo',
    'row.tag.trash':          'papelera',
    'row.action.restore':     'Restaurar de papelera',
    'row.action.delete_hard': 'Eliminar permanentemente',
    'row.action.delete_soft': 'Mover a papelera',
    'confirm.soft':           '¿Mover este prospecto a la papelera? Puedes restaurarlo después.',
    'confirm.hard':           '¿Eliminar PERMANENTEMENTE este prospecto Y todas sus respuestas, resumen, demo y eventos? No se puede deshacer.',
    'detail.back':            '← Volver a la lista',
    'detail.prospect_view':   'Vista del prospecto ↗',
    'detail.costs':           'Costos API',
    'detail.open_demo':       'Abrir demo pantalla completa ↗',
    'detail.regen.btn':       '⟳ Regenerar en {lang}',
    'detail.regen.btn_loading':'Regenerando en {lang}…',
    'detail.regen.title':     'El resumen y el dashboard de este prospecto fueron generados en otro idioma. Haz clic para regenerarlos en el idioma actual del admin.',
    'detail.regen.summary_loading':   'Regenerando resumen IA en {lang}… (10–25 seg)',
    'detail.regen.dashboard_loading': 'Regenerando dashboard personalizado en {lang}… (15–35 seg)',
    'detail.section.summary': '// RESUMEN IA',
    'detail.section.demo':    '// DASHBOARD DE DEMO PERSONALIZADO',
    'detail.section.answers': '// RESPUESTAS',
    'detail.section.events':  '// HISTORIAL DE EVENTOS',
    'detail.section.notif':   '// NOTIFICACIONES',
    'detail.no_summary':      '// aún sin resumen',
    'detail.no_demo':         '// aún no se generó dashboard',
    'detail.no_demo_sub':     'El perfil del prospecto tiene resumen pero no un demo personalizado. Pulsa abajo para construirlo con el pipeline de agentes, luego refínalo en el editor a la derecha.',
    'detail.generating':      'Ejecutando pipeline de 7 pasos... toma ~25 segundos.',
    'detail.generate_cta':    'Generar dashboard →',
    'detail.generating_btn':  'Generando…',
    'detail.kv.sector':       'Sector',
    'detail.kv.capability':   'Capacidad',
    'detail.kv.hrs_saved':    'Horas/sem ahorradas',
    'detail.kv.payback':      'Payback (meses)',
    'detail.demo.gen_at':     'generado',
    'detail.demo.edited':     'editado',
    'detail.demo.auto':       'auto',
    'editor.title':           '// EDITOR DEL DASHBOARD',
    'editor.model_tag':       'claude · suite de 12 agentes',
    'editor.empty':           '// describe un cambio — ej. "reescribe el titular" — y la suite de agentes lo aplicará en vivo al dashboard',
    'editor.empty.eye':       '// suite de agentes lista',
    'editor.empty.heading':   'Dile a los agentes qué cambiar.',
    'editor.empty.sub':       'Prueba "reescribe el titular mencionando sus 38 empleados" o "agrega una sección sobre onboarding". Los 12 especialistas enrutan solos.',
    'editor.orchestrating':   'orquestando agentes…',
    'editor.placeholder':     '// dile a los agentes qué cambiar…',
    'editor.placeholder_img': '// describe qué quieres arreglar en la imagen…',
    'editor.send':            'Enviar →',
    'editor.attach':          'Adjuntar imagen',
    'editor.mainAgent':       'Agente principal',
    'admin.lang.regen_prompt':'¿Regenerar el dashboard de este prospecto en el nuevo idioma? Se sobrescribirán las ediciones actuales.',
    'admin.lang.regen_toast': 'Regenerando contenido del prospecto en el nuevo idioma…',
    'admin.lang.regen_done':  'Contenido del prospecto regenerado.',
    'admin.lang.regen_error': 'La regeneración falló. Intenta de nuevo o revisa la consola.',
    'empty.detail.eye':       '// sin prospecto seleccionado',
    'empty.detail.heading':   'Elige a alguien a la izquierda.',
    'empty.detail.sub':       'Su resumen, sus respuestas del discovery y el dashboard personalizado aparecen aquí. Las ediciones pasan por los 12 agentes especializados.',
    'empty.detail.stat.total':   'Total',
    'empty.detail.stat.demo':    'Con demo',
    'empty.detail.stat.pending': 'Sin demo',
    'list.empty.no_prospects.eye':      '// aún no hay prospectos',
    'list.empty.no_prospects.heading':  'El discovery no ha arrancado.',
    'list.empty.no_prospects.sub':      'Cuando alguien complete la voz o el formulario, aparecerá aquí agrupado por día.',
    'list.empty.filtered.eye':          '// sin coincidencias',
    'list.empty.filtered.heading':      'Nada en esta vista.',
    'list.empty.filtered.sub':          'Limpia la búsqueda o cambia el filtro de estado para ver más.',
    'editor.empty_select':    '// selecciona un prospecto a la izquierda para ver su resumen, respuestas y dashboard personalizado',
    'editor.loading_detail':  '// cargando detalle…',
    'editor.raw_toggle':      '// JSON crudo del payload demo',
    'qp.headline':            'Reescribir titular',
    'qp.kpis':                'Rediseñar KPIs',
    'qp.recs':                '10 recomendaciones',
    'qp.risks':               'Riesgos que deben conocer',
    'qp.roadmap':             'Roadmap 12 semanas',
    'qp.roi':                 'Cálculo de ROI',
    'qp.optims':              'Optimizaciones de proceso',
    'qp.insights':            'Rehacer insights',
    'qp.polish':              'Pulir todo',
    'login.eye':              '// ADMIN ARQENTIA',
    'login.redirecting':      'Redirigiendo al login…'
  }
};
function T(key, vars) {
  const lang = admLang();
  let s = (STRINGS[lang] && STRINGS[lang][key]) || (STRINGS.en[key] || key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}

// Sector code → display label, in the admin's chosen language.
// Mirrors discovery/profile.js LABELS.industry so the admin renders
// "Manufacturing" / "Manufactura" instead of the raw "manufactura" slug.
const SECTOR_LABELS = {
  distribucion:  { en: 'Distribution',  es: 'Distribución' },
  retail:        { en: 'Retail',        es: 'Retail' },
  manufactura:   { en: 'Manufacturing', es: 'Manufactura' },
  servicios:     { en: 'Services',      es: 'Servicios' },
  logistica:     { en: 'Logistics',     es: 'Logística' },
  salud:         { en: 'Healthcare',    es: 'Salud' },
  construccion:  { en: 'Construction',  es: 'Construcción' },
  educacion:     { en: 'Education',     es: 'Educación' },
  other:         { en: 'Other',         es: 'Otro' }
};
function sectorLabel(code) {
  if (!code) return '—';
  const entry = SECTOR_LABELS[String(code).toLowerCase()];
  if (entry) return entry[admLang()] || entry.en || code;
  // Unknown code — capitalize first letter so "manufactura" → "Manufactura"
  return String(code).charAt(0).toUpperCase() + String(code).slice(1);
}

function initials(p) {
  if (p?.name) {
    const parts = p.name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (p?.email) return p.email.slice(0, 2).toUpperCase();
  if (p?.company) return p.company.slice(0, 2).toUpperCase();
  return '··';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Turn a prospect into a friendly URL slug for display.
// "Rafael Schwartz" → "rafael-schwartz". Falls back to company, then email
// local-part, then the first 8 chars of the magic_token if nothing else.
function slugifyProspect(p) {
  const raw = p?.name || p?.company || (p?.email ? p.email.split('@')[0] : null) || (p?.magic_token ? p.magic_token.slice(0, 8) : '') || 'prospect';
  return String(raw)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'prospect';
}

function fmtUsd(n) {
  const v = Number(n || 0);
  if (v >= 100)   return '$' + v.toFixed(0);
  if (v >= 1)     return '$' + v.toFixed(2);
  if (v >= 0.01)  return '$' + v.toFixed(3);
  if (v === 0)    return '$0.00';
  return '$' + v.toFixed(4);
}

function fmtTokens(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'k';
  return String(v);
}

function fmtSec(n) {
  const v = Number(n || 0);
  if (v >= 3600) return (v / 3600).toFixed(1) + 'h';
  if (v >= 60)   return (v / 60).toFixed(1) + 'm';
  return v.toFixed(0) + 's';
}

function fmtAnswer(a) {
  if (a.value_text) return esc(a.value_text);
  if (a.value_json) return `<code style="font-size:11px;color:rgba(255,255,255,.7);">${esc(JSON.stringify(a.value_json))}</code>`;
  return '<span style="color:rgba(255,255,255,.3);">—</span>';
}

// ─── API ───────────────────────────────────────────────────────────────────
async function apiGet(path) {
  const r = await fetch(`/api/admin${path}`, { credentials: 'same-origin' });
  if (r.status === 401) { state.needsLogin = true; render(); throw new Error('Auth required'); }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`API ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function login(password) {
  const r = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password })
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data?.error || `HTTP ${r.status}`);
  }
  return true;
}

async function logout() {
  await fetch('/api/admin/login', { method: 'DELETE', credentials: 'same-origin' });
  state.needsLogin = true;
  state.prospects = [];
  state.selectedId = null;
  state.detail = null;
  render();
}

async function loadList() {
  state.loading = true;
  render();
  try {
    const params = new URLSearchParams();
    if (state.filter.status) params.set('status', state.filter.status);
    if (state.filter.sector) params.set('sector', state.filter.sector);
    const q = params.toString();
    const data = await apiGet(`/prospects${q ? '?' + q : ''}`);
    state.prospects = data.prospects || [];
  } catch (e) {
    console.error('[admin] list failed', e);
    state.prospects = [];
  }
  state.loading = false;
  render();
}

async function loadDetail(id) {
  // Switching prospects resets the editor (different prospect → different chat)
  if (state.selectedId !== id) {
    state.editor.messages = [];
    state.editor.input = '';
    state.editor.pending = false;
  }
  // Always fresh iframe URL — avoids browser caching a stale demo render
  state.editor.iframeBuster = Date.now();
  state.selectedId = id;
  state.detail = null;
  render();
  try {
    const data = await apiGet(`/prospects?id=${encodeURIComponent(id)}`);
    if (state.selectedId === id) {
      state.detail = data;
      render();
    }
  } catch (e) {
    console.error('[admin] detail failed', e);
    state.detail = { error: e.message };
    render();
  }
}

// ─── RENDER ────────────────────────────────────────────────────────────────
function filteredProspects() {
  const q = state.filter.search.trim().toLowerCase();
  if (!q) return state.prospects;
  return state.prospects.filter(p =>
    (p.name || '').toLowerCase().includes(q)
    || (p.company || '').toLowerCase().includes(q)
    || (p.email || '').toLowerCase().includes(q)
    || (p.sector_id || '').toLowerCase().includes(q)
  );
}

function render() {
  if (state.needsLogin) { renderLogin(); return; }

  const items = filteredProspects();
  const isDetailOpen = !!state.selectedId;
  const hasDemo     = !!state.detail?.demo;

  root.innerHTML = `
    <div class="adm-shell${isDetailOpen ? ' is-detail' : ''}${isDetailOpen && hasDemo ? ' has-editor' : ''}">
      <header class="adm-topbar">
        <a class="adm-topbar__brand" href="/arqentia/admin">Arqentia</a>
        <span class="adm-topbar__meta">
          ${state.loading ? T('topbar.loading') : T('topbar.prospects', { n: state.prospects.length })}
          <button type="button" class="adm-topbar__spend${state.usage ? '' : ' adm-topbar__spend--loading'}" data-action="open-costs" data-prospect-id=""
                  title="${esc(T('topbar.spend.tooltip'))}"
                  aria-busy="${state.usage ? 'false' : 'true'}">
            <span class="adm-topbar__spend-k">${esc(T('topbar.spend.label'))}</span>
            <span class="adm-topbar__spend-v">${state.usage ? fmtUsd(state.usage.summary.today.cost_usd) : '<span class="adm-topbar__spend-skeleton" aria-hidden="true"></span>'}</span>
          </button>
          <span class="adm-lang">
            <button type="button" class="adm-lang__btn ${admLang() === 'en' ? 'is-active' : ''}" data-set-lang="en">EN</button>
            <span aria-hidden="true">·</span>
            <button type="button" class="adm-lang__btn ${admLang() === 'es' ? 'is-active' : ''}" data-set-lang="es">ES</button>
          </span>
          <button type="button" class="adm-topbar__logout" id="adm-logout">${T('topbar.logout')}</button>
        </span>
      </header>

      <aside class="adm-list">
        <div class="adm-list__filters">
          <input
            class="adm-list__search"
            type="search"
            placeholder="${esc(T('list.search_placeholder'))}"
            value="${esc(state.filter.search)}"
            id="adm-search"
          />
          <div class="adm-list__chips">
            ${chip(T('chip.all'),       null,        !state.filter.status)}
            ${chip(T('chip.completed'), 'completed', state.filter.status === 'completed')}
            ${chip(T('chip.started'),   'started',   state.filter.status === 'started')}
            ${chip(T('chip.trash'),     'deleted',   state.filter.status === 'deleted')}
          </div>
        </div>
        <div class="adm-list__rows">
          ${items.length === 0
            ? renderListEmpty()
            : renderGroupedList(items)}
        </div>
      </aside>

      <main class="adm-detail">
        ${state.selectedId ? renderDetail() : renderEmpty()}
      </main>

      ${isDetailOpen && hasDemo ? renderEditor() : ''}
    </div>
    ${state.costs.open ? renderCostsModal() : ''}
  `;
  bindEvents();
}

// ─── LOGIN GATE ────────────────────────────────────────────────────────────
// Unified sign-in: redirect unauthenticated admins to /discovery/login. The
// same form handles both admin and prospect sign-in (server checks email
// against the hardcoded admin address and routes the response).
function renderLogin() {
  const dest = encodeURIComponent('/arqentia/admin');
  // Replace so the back button doesn't loop them through the redirect again
  window.location.replace(`/discovery/login?next=${dest}`);
  // Placeholder while the browser navigates — visible only for ~50ms
  root.innerHTML = `
    <div class="adm-login">
      <div class="adm-login__card">
        <p class="adm-login__eye">${esc(T('login.eye'))}</p>
        <p class="adm-login__sub">${esc(T('login.redirecting'))}</p>
      </div>
    </div>
  `;
}

function chip(label, value, active) {
  return `<button type="button" class="adm-chip${active ? ' is-active' : ''}" data-status="${value || ''}">${esc(label)}</button>`;
}

// Group prospects by created_at day → kanban-style sections
// Buckets: Today, Yesterday, This week (last 7d), This month (last 30d), Older
function bucketByDay(prospects) {
  const now = new Date();
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = dayStart(now);
  const yest  = today - 86400_000;
  const week  = today - 6 * 86400_000;
  const month = today - 29 * 86400_000;

  const buckets = { today: [], yest: [], week: [], month: [], older: [] };
  for (const p of prospects) {
    const ts = new Date(p.created_at).getTime();
    if (ts >= today)      buckets.today.push(p);
    else if (ts >= yest)  buckets.yest.push(p);
    else if (ts >= week)  buckets.week.push(p);
    else if (ts >= month) buckets.month.push(p);
    else                  buckets.older.push(p);
  }
  return buckets;
}

function getBucketLabels() {
  return {
    today: T('bucket.today'),
    yest:  T('bucket.yesterday'),
    week:  T('bucket.week'),
    month: T('bucket.month'),
    older: T('bucket.older')
  };
}

function renderRow(p) {
  const isSel = state.selectedId === p.id;
  const hasDemo = !!p.demo;
  const sector = p.sector_id ? sectorLabel(p.sector_id) : T('list.unclassified');
  const isTrash = p.status === 'deleted';
  return `
    <div class="adm-row${isSel ? ' is-selected' : ''}${isTrash ? ' is-trash' : ''}" data-id="${esc(p.id)}">
      <div class="adm-row__main">
        <p class="adm-row__name">${esc(p.name || p.email || p.company || 'Anonymous')}</p>
        <p class="adm-row__sub">
          <span>${esc(p.company || '—')}</span>
          <span>·</span>
          <span>${fmtDate(p.created_at)}</span>
        </p>
        <div class="adm-row__tags">
          <span class="adm-tag adm-tag--sector">${esc(sector)}</span>
          ${isTrash
            ? `<span class="adm-tag adm-tag--trash">${esc(T('row.tag.trash'))}</span>`
            : hasDemo
              ? `<span class="adm-tag adm-tag--ok">${esc(T('row.tag.demo_ready'))}</span>`
              : `<span class="adm-tag adm-tag--missing">${esc(T('row.tag.no_demo'))}</span>`}
        </div>
      </div>
      <div class="adm-row__actions">
        ${isTrash
          ? `<button type="button" class="adm-row__icon-btn" title="${esc(T('row.action.restore'))}" data-action="restore" data-id="${esc(p.id)}">↺</button>
             <button type="button" class="adm-row__icon-btn adm-row__icon-btn--danger" title="${esc(T('row.action.delete_hard'))}" data-action="hard-delete" data-id="${esc(p.id)}">×</button>`
          : `<button type="button" class="adm-row__icon-btn adm-row__icon-btn--danger" title="${esc(T('row.action.delete_soft'))}" data-action="soft-delete" data-id="${esc(p.id)}">×</button>`}
      </div>
    </div>
  `;
}

function renderGroupedList(items) {
  const buckets = bucketByDay(items);
  const labels = getBucketLabels();
  let html = '';
  for (const key of ['today', 'yest', 'week', 'month', 'older']) {
    const group = buckets[key];
    if (!group.length) continue;
    html += `
      <div class="adm-group">
        <p class="adm-group__head">// ${esc(labels[key])} <span class="adm-group__count">${group.length}</span></p>
        ${group.map(p => renderRow(p)).join('')}
      </div>
    `;
  }
  return html;
}

function renderListEmpty() {
  if (state.loading) {
    return `<div class="adm-list__empty">
      <p class="adm-list__empty-eye">${esc(T('list.empty.loading'))}</p>
    </div>`;
  }
  const filt = state.filter;
  const isFiltered = !!(filt.search || filt.status || filt.sector);
  const eye = isFiltered ? T('list.empty.filtered.eye') : T('list.empty.no_prospects.eye');
  const head = isFiltered ? T('list.empty.filtered.heading') : T('list.empty.no_prospects.heading');
  const sub  = isFiltered ? T('list.empty.filtered.sub')     : T('list.empty.no_prospects.sub');
  return `
    <div class="adm-list__empty">
      <p class="adm-list__empty-eye">${esc(eye)}</p>
      <h3 class="adm-list__empty-h">${esc(head)}</h3>
      <p class="adm-list__empty-sub">${esc(sub)}</p>
    </div>
  `;
}

function renderEmpty() {
  const all = state.prospects || [];
  const total = all.filter(p => p.status !== 'deleted').length;
  const withDemo = all.filter(p => p.demo && p.status !== 'deleted').length;
  const pending  = Math.max(0, total - withDemo);
  return `
    <div class="adm-detail__empty">
      <div class="adm-detail__empty-inner">
        <div class="adm-detail__empty-art" aria-hidden="true"></div>
        <p class="adm-detail__empty-eye">${esc(T('empty.detail.eye'))}</p>
        <h2 class="adm-detail__empty-h">${esc(T('empty.detail.heading'))}</h2>
        <p class="adm-detail__empty-sub">${esc(T('empty.detail.sub'))}</p>
        <div class="adm-detail__empty-meta">
          <div class="adm-detail__empty-stat">
            <span class="adm-detail__empty-stat-k">${esc(T('empty.detail.stat.total'))}</span>
            <span class="adm-detail__empty-stat-v">${total}</span>
          </div>
          <div class="adm-detail__empty-stat">
            <span class="adm-detail__empty-stat-k">${esc(T('empty.detail.stat.demo'))}</span>
            <span class="adm-detail__empty-stat-v">${withDemo}</span>
          </div>
          <div class="adm-detail__empty-stat">
            <span class="adm-detail__empty-stat-k">${esc(T('empty.detail.stat.pending'))}</span>
            <span class="adm-detail__empty-stat-v">${pending}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── COSTS MODAL ──────────────────────────────────────────────────────────────
function renderCostsModal() {
  const c = state.costs;
  const isProspect = c.scope === 'prospect' && c.prospectId;
  const title = isProspect ? T('costs.title.prospect') : T('costs.title.overview');
  const subtitle = isProspect && c.data && state.prospects.length
    ? (state.prospects.find(p => p.id === c.prospectId)?.name
       || state.prospects.find(p => p.id === c.prospectId)?.email
       || c.prospectId.slice(0, 8))
    : T('costs.subtitle.overview');

  let body;
  if (c.loading) {
    body = `<div class="adm-costs__loading"><div class="adm-ed__dots"><span></span><span></span><span></span></div></div>`;
  } else if (c.error) {
    body = `<p class="adm-costs__err">${esc(c.error)}</p>`;
  } else if (!c.data) {
    body = `<p class="adm-costs__err">${esc(T('costs.no_data'))}</p>`;
  } else if (c.data.migration_needed) {
    body = `<div class="adm-costs__migration">
      <p class="adm-costs__migration-eye">${esc(T('costs.migration.eye'))}</p>
      <h3 class="adm-costs__migration-h">${esc(T('costs.migration.heading'))}</h3>
      <p class="adm-costs__migration-sub">${esc(T('costs.migration.sub'))}</p>
      <code class="adm-costs__migration-path">supabase/migrations/0003_token_usage.sql</code>
    </div>`;
  } else if (isProspect) {
    body = renderCostsProspect(c.data);
  } else {
    body = renderCostsOverview(c.data);
  }

  return `
    <div class="adm-costs__backdrop" data-action="close-costs"></div>
    <div class="adm-costs" role="dialog" aria-labelledby="adm-costs-title">
      <header class="adm-costs__head">
        <div>
          <p class="adm-costs__eye">${esc(T('costs.eye'))}</p>
          <h2 class="adm-costs__title" id="adm-costs-title">${esc(title)}</h2>
          <p class="adm-costs__sub">${esc(subtitle)}</p>
        </div>
        <button type="button" class="adm-costs__close" data-action="close-costs" aria-label="${esc(T('costs.close'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </header>
      <div class="adm-costs__body">${body}</div>
    </div>
  `;
}

function renderCostsOverview(d) {
  const sum = d.summary || {};
  const series = d.daily_series || [];
  const maxDay = Math.max(0.0001, ...series.map(s => s.cost_usd));
  return `
    <div class="adm-costs__cards">
      ${costCard(T('costs.bucket.today'), sum.today)}
      ${costCard(T('costs.bucket.week'),  sum.week)}
      ${costCard(T('costs.bucket.month'), sum.month)}
      ${costCard(T('costs.bucket.all'),   sum.all_time)}
    </div>

    <section class="adm-costs__section">
      <p class="adm-costs__section-title">${esc(T('costs.daily'))}</p>
      <div class="adm-costs__bars">
        ${series.map(s => {
          // No bar for $0 days — render only the baseline tick so admin can
          // distinguish a genuine zero-spend day from any non-zero day.
          const isZero = !s.cost_usd;
          const pct = isZero ? 0 : Math.max(4, (s.cost_usd / maxDay) * 100);
          return `
          <div class="adm-costs__bar${isZero ? ' adm-costs__bar--zero' : ''}" title="${esc(s.date)} · ${esc(fmtUsd(s.cost_usd))} (${s.calls} ${esc(T('costs.calls_short'))})">
            <div class="adm-costs__bar-fill" style="height: ${pct}%"></div>
            <span class="adm-costs__bar-label">${esc(s.date.slice(5))}</span>
          </div>
        `;
        }).join('')}
      </div>
    </section>

    <div class="adm-costs__grid">
      <section class="adm-costs__section">
        <p class="adm-costs__section-title">${esc(T('costs.by_provider'))}</p>
        ${renderCostsTable(d.by_provider, T('costs.col.provider'))}
      </section>
      <section class="adm-costs__section">
        <p class="adm-costs__section-title">${esc(T('costs.by_model'))}</p>
        ${renderCostsTable(d.by_model, T('costs.col.model'))}
      </section>
    </div>

    <section class="adm-costs__section">
      <p class="adm-costs__section-title">${esc(T('costs.top_prospects'))}</p>
      ${(d.top_prospects || []).length === 0
        ? `<p class="adm-costs__hint">${esc(T('costs.no_prospects'))}</p>`
        : `<div class="adm-costs__list">
            ${d.top_prospects.map(p => `
              <button type="button" class="adm-costs__list-row" data-action="open-costs" data-prospect-id="${esc(p.prospect_id || '')}">
                <span class="adm-costs__list-name">${esc(p.name || p.company || p.email || (p.prospect_id ? p.prospect_id.slice(0,8) : T('costs.anonymous')))}</span>
                <span class="adm-costs__list-meta">${p.calls} ${esc(T('costs.calls_short'))} · ${fmtTokens(p.tokens)} ${esc(T('costs.tokens_short'))}</span>
                <span class="adm-costs__list-cost">${esc(fmtUsd(p.cost_usd))}</span>
              </button>
            `).join('')}
          </div>`
      }
    </section>
  `;
}

function renderCostsProspect(d) {
  const t = d.totals || {};
  return `
    <div class="adm-costs__cards">
      ${costCard(T('costs.bucket.all_calls'),  t)}
      ${miniCard(T('costs.bucket.in_tokens'),  fmtTokens(t.input_tokens))}
      ${miniCard(T('costs.bucket.out_tokens'), fmtTokens(t.output_tokens))}
      ${miniCard(T('costs.bucket.voice_sec'),  fmtSec((t.audio_input_sec||0) + (t.audio_output_sec||0)))}
    </div>

    <div class="adm-costs__grid">
      <section class="adm-costs__section">
        <p class="adm-costs__section-title">${esc(T('costs.by_provider'))}</p>
        ${renderCostsTable(d.by_provider, T('costs.col.provider'))}
      </section>
      <section class="adm-costs__section">
        <p class="adm-costs__section-title">${esc(T('costs.by_model'))}</p>
        ${renderCostsTable(d.by_model, T('costs.col.model'))}
      </section>
    </div>

    <section class="adm-costs__section">
      <p class="adm-costs__section-title">${esc(T('costs.by_route'))}</p>
      ${renderCostsTable(d.by_route, T('costs.col.route'))}
    </section>

    <section class="adm-costs__section">
      <p class="adm-costs__section-title">${esc(T('costs.recent_calls'))} <span class="adm-costs__hint-inline">${(d.calls || []).length}</span></p>
      <div class="adm-costs__calls">
        <div class="adm-costs__calls-head">
          <span>${esc(T('costs.col.when'))}</span>
          <span>${esc(T('costs.col.model'))}</span>
          <span>${esc(T('costs.col.route'))}</span>
          <span>${esc(T('costs.col.in'))}</span>
          <span>${esc(T('costs.col.out'))}</span>
          <span>${esc(T('costs.col.cost'))}</span>
        </div>
        ${(d.calls || []).slice(0, 200).map(call => `
          <div class="adm-costs__calls-row">
            <span class="adm-costs__calls-when">${fmtDate(call.created_at)}</span>
            <span class="adm-costs__calls-model">${esc(shortModel(call.model))}</span>
            <span class="adm-costs__calls-route">${esc(call.route || '—')}</span>
            <span class="adm-costs__calls-num">${fmtTokens(call.input_tokens)}</span>
            <span class="adm-costs__calls-num">${fmtTokens(call.output_tokens)}</span>
            <span class="adm-costs__calls-cost">${esc(fmtUsd(call.cost_usd))}</span>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function costCard(label, bucket) {
  const b = bucket || {};
  return `
    <div class="adm-costs__card">
      <p class="adm-costs__card-k">${esc(label)}</p>
      <p class="adm-costs__card-v">${esc(fmtUsd(b.cost_usd))}</p>
      <p class="adm-costs__card-meta">${b.calls || 0} ${esc(T('costs.calls_short'))} · ${fmtTokens((b.input_tokens || 0) + (b.output_tokens || 0))} ${esc(T('costs.tokens_short'))}</p>
    </div>
  `;
}

function miniCard(label, value) {
  return `
    <div class="adm-costs__card adm-costs__card--mini">
      <p class="adm-costs__card-k">${esc(label)}</p>
      <p class="adm-costs__card-v">${esc(value)}</p>
    </div>
  `;
}

function renderCostsTable(groupMap, header) {
  const entries = Object.entries(groupMap || {}).sort(([,a], [,b]) => b.cost_usd - a.cost_usd);
  if (!entries.length) return `<p class="adm-costs__hint">${esc(T('costs.empty'))}</p>`;
  const total = entries.reduce((s, [,v]) => s + v.cost_usd, 0) || 1;
  return `
    <div class="adm-costs__table">
      <div class="adm-costs__table-head">
        <span>${esc(header)}</span>
        <span>${esc(T('costs.col.calls'))}</span>
        <span>${esc(T('costs.col.tokens'))}</span>
        <span>${esc(T('costs.col.cost'))}</span>
      </div>
      ${entries.map(([key, v]) => {
        const pct = (v.cost_usd / total) * 100;
        return `
          <div class="adm-costs__table-row">
            <span class="adm-costs__table-key">${esc(shortModel(key))}</span>
            <span class="adm-costs__table-num">${v.calls}</span>
            <span class="adm-costs__table-num">${fmtTokens((v.input_tokens||0) + (v.output_tokens||0))}</span>
            <span class="adm-costs__table-cost">
              ${esc(fmtUsd(v.cost_usd))}
              <i class="adm-costs__table-bar" style="width: ${pct.toFixed(1)}%" aria-hidden="true"></i>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function shortModel(m) {
  if (!m) return '—';
  return String(m)
    .replace(/^claude-/, '')
    .replace(/^gpt-/, '')
    .replace(/-\d{8}$/, '');
}

async function openCostsModal(prospectId) {
  state.costs.open = true;
  state.costs.scope = prospectId ? 'prospect' : 'overview';
  state.costs.prospectId = prospectId || null;
  state.costs.loading = true;
  state.costs.error = null;
  state.costs.data = null;
  render();
  try {
    const url = prospectId
      ? `/api/admin/token-usage?prospect_id=${encodeURIComponent(prospectId)}`
      : `/api/admin/token-usage`;
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      state.costs.error = data?.error || `HTTP ${r.status}`;
    } else {
      state.costs.data = data;
      // Also refresh the topbar pill if we got fresh overview data
      if (!prospectId && data.summary) state.usage = data;
    }
  } catch (e) {
    state.costs.error = `Network error: ${e.message}`;
  }
  state.costs.loading = false;
  render();
}

function closeCostsModal() {
  state.costs.open = false;
  state.costs.scope = 'overview';
  state.costs.prospectId = null;
  state.costs.data = null;
  state.costs.error = null;
  render();
}

async function loadUsageOverview() {
  if (state.usageLoading) return;
  state.usageLoading = true;
  try {
    const r = await fetch('/api/admin/token-usage');
    if (!r.ok) return;
    const data = await r.json();
    state.usage = data;
    render();
  } catch {}
  state.usageLoading = false;
}

function renderDetail() {
  if (!state.detail) {
    return `<div class="adm-detail__inner"><p style="color:rgba(255,255,255,.4);font-family:var(--font-mono);font-size:11px;">${esc(T('editor.loading_detail'))}</p></div>`;
  }
  if (state.detail.error) {
    return `<div class="adm-detail__inner"><p style="color:#fca5a5;">// error: ${esc(state.detail.error)}</p></div>`;
  }
  const { prospect, answers, summary, demo, events, notifications } = state.detail;
  const profileUrl = `/discovery/p/${prospect.magic_token}`;
  const demoUrl    = `/discovery/p/${prospect.magic_token}/demo`;
  // Demo URL for admin full-screen view — `internal=1` bypasses the prospect-
  // redirect guard in demo-preview.js, so admin sees the demo regardless of
  // whether the arq_admin cookie is sniffed correctly across the new tab.
  const demoUrlAdmin = `${demoUrl}?internal=1`;
  // Friendly path shown in the iframe metadata bar. The real route requires
  // the magic_token (it's an unguessable session token), but admins shouldn't
  // have to look at hex — show name/company-derived slug for legibility.
  const demoUrlPretty = `/discovery/p/${slugifyProspect(prospect)}/demo`;

  return `
    <div class="adm-detail__inner">
      <button type="button" class="adm-detail__back" id="adm-back">${esc(T('detail.back'))}</button>

      <header class="adm-detail__header">
        <div class="adm-detail__avatar">${esc(initials(prospect))}</div>
        <div>
          <h1 class="adm-detail__name">${esc(prospect.name || prospect.email || prospect.company || 'Anonymous')}</h1>
          <div class="adm-detail__sub">
            <span>${esc(prospect.company || '—')}</span>
            <span>·</span>
            <span>${esc(prospect.role || '—')}</span>
            <span>·</span>
            <span>${esc(sectorLabel(prospect.sector_id))}</span>
            <span>·</span>
            <span>${esc(prospect.language)}</span>
          </div>
          <p class="adm-detail__contact">
            ${esc(prospect.email || 'no email')} · ${esc(prospect.phone || 'no phone')} · created ${fmtDate(prospect.created_at)}
          </p>
        </div>
        <div class="adm-detail__actions">
          ${(() => {
            const inFlight = !!state.regen;
            const d = detectLanguageDrift();
            // While regen is running, keep the button in its loading state.
            if (inFlight) {
              const lang = state.regen.lang.toUpperCase();
              return `<button type="button" class="adm-btn adm-btn--accent is-loading" data-action="regen-content" disabled aria-busy="true">
                        <span class="adm-spinner" aria-hidden="true"></span>
                        ${esc(T('detail.regen.btn_loading').replace('{lang}', lang))}
                      </button>`;
            }
            // Otherwise show the button only when there's actual drift.
            if (!d.any) return '';
            return `<button type="button" class="adm-btn adm-btn--accent" data-action="regen-content"
                      title="${esc(T('detail.regen.title'))}">
                      ${esc(T('detail.regen.btn').replace('{lang}', d.toLang.toUpperCase()))}
                    </button>`;
          })()}
          <a class="adm-btn" href="${esc(profileUrl)}" target="_blank" rel="noopener">${esc(T('detail.prospect_view'))}</a>
          <button type="button" class="adm-btn" data-action="open-costs" data-prospect-id="${esc(prospect.id)}">${esc(T('detail.costs'))}</button>
          <a class="adm-btn adm-btn--primary" href="${esc(demoUrlAdmin)}" target="_blank" rel="noopener">${esc(T('detail.open_demo'))}</a>
        </div>
      </header>

      <!-- AI SUMMARY -->
      <section class="adm-section${state.regen && state.regen.summary ? ' adm-section--regenerating' : ''}">
        <p class="adm-section__title">${esc(T('detail.section.summary'))}</p>
        ${state.regen && state.regen.summary ? `
          <div class="adm-regen-overlay" role="status" aria-live="polite">
            <span class="adm-spinner adm-spinner--lg" aria-hidden="true"></span>
            <span class="adm-regen-overlay__msg">${esc(T('detail.regen.summary_loading').replace('{lang}', state.regen.lang.toUpperCase()))}</span>
          </div>
        ` : ''}
        ${summary
          ? `<div class="adm-summary">${summary.summary_text || '<em>—</em>'}</div>
             <div class="adm-kv" style="margin-top:12px;">
               <div class="adm-kv__cell"><span class="adm-kv__k">${esc(T('detail.kv.sector'))}</span><span class="adm-kv__v">${esc(sectorLabel(summary.sector_classification))}</span></div>
               <div class="adm-kv__cell"><span class="adm-kv__k">${esc(T('detail.kv.capability'))}</span><span class="adm-kv__v">${esc(summary.suggested_capability || '—')}</span></div>
               <div class="adm-kv__cell"><span class="adm-kv__k">${esc(T('detail.kv.hrs_saved'))}</span><span class="adm-kv__v">${esc(String(summary.est_hours_saved ?? '—'))}</span></div>
               <div class="adm-kv__cell"><span class="adm-kv__k">${esc(T('detail.kv.payback'))}</span><span class="adm-kv__v">${esc(String(summary.est_payback_months ?? '—'))}</span></div>
             </div>`
          : `<p style="color:rgba(255,255,255,.4);font-family:var(--font-mono);font-size:11px;">${esc(T('detail.no_summary'))}</p>`}
      </section>

      <!-- DEMO PREVIEW -->
      <section class="adm-section${state.regen && state.regen.dashboard ? ' adm-section--regenerating' : ''}">
        <p class="adm-section__title">${esc(T('detail.section.demo'))}</p>
        ${state.regen && state.regen.dashboard ? `
          <div class="adm-regen-overlay" role="status" aria-live="polite">
            <span class="adm-spinner adm-spinner--lg" aria-hidden="true"></span>
            <span class="adm-regen-overlay__msg">${esc(T('detail.regen.dashboard_loading').replace('{lang}', state.regen.lang.toUpperCase()))}</span>
          </div>
        ` : ''}
        ${demo
          ? `<div class="adm-demo is-loading">
               <div class="adm-demo__bar">
                 <span class="adm-demo__url">${esc(demoUrlPretty)}</span>
                 <span class="adm-demo__url">${esc(T('detail.demo.gen_at'))} ${fmtDate(demo.generated_at)} · ${demo.edited ? esc(T('detail.demo.edited')) : esc(T('detail.demo.auto'))}</span>
               </div>
               <div class="adm-demo__skeleton" aria-hidden="true"></div>
               <iframe class="adm-demo__frame" src="${esc(demoUrl)}?internal=1&_t=${state.editor.iframeBuster}" title="Personalized demo dashboard" onload="this.closest('.adm-demo').classList.remove('is-loading')"></iframe>
             </div>`
          : `<div class="adm-demo adm-demo--empty">
               <p class="adm-demo__empty-title">${esc(T('detail.no_demo'))}</p>
               <p class="adm-demo__empty-sub">${esc(state.generating ? T('detail.generating') : T('detail.no_demo_sub'))}</p>
               <button type="button" class="adm-btn adm-btn--primary" id="adm-generate-btn" ${state.generating ? 'disabled' : ''}>
                 ${esc(state.generating ? T('detail.generating_btn') : T('detail.generate_cta'))}
               </button>
               ${state.generateError ? `<p class="adm-demo__empty-err">${esc(state.generateError)}</p>` : ''}
             </div>`}
      </section>

      <!-- ANSWERS -->
      <section class="adm-section">
        <p class="adm-section__title">${esc(T('detail.section.answers'))} (${answers.length})</p>
        <div class="adm-answers">
          ${answers.map(a => `
            <div class="adm-answer">
              <span class="adm-answer__q">${esc(a.question_id)}</span>
              <div class="adm-answer__v">${fmtAnswer(a)}</div>
            </div>
          `).join('')}
        </div>
      </section>

      <!-- EVENT TRAIL -->
      <section class="adm-section">
        <p class="adm-section__title">${esc(T('detail.section.events'))} (${events.length})</p>
        <div class="adm-log">
          ${events.slice().reverse().map(e => `
            <div class="adm-log__row">
              <span class="adm-log__time">${fmtDate(e.created_at)}</span>
              <span class="adm-log__type">${esc(e.type)}</span>
              <span>${e.payload && Object.keys(e.payload).length ? esc(JSON.stringify(e.payload)) : ''}</span>
            </div>
          `).join('')}
        </div>
      </section>

      ${notifications.length ? `
        <section class="adm-section">
          <p class="adm-section__title">${esc(T('detail.section.notif'))} (${notifications.length})</p>
          <div class="adm-log">
            ${notifications.map(n => `
              <div class="adm-log__row">
                <span class="adm-log__time">${fmtDate(n.sent_at || n.created_at)}</span>
                <span class="adm-log__type">${esc(n.channel)} · ${esc(n.status)}</span>
                <span>${esc(n.error || '')}</span>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}

      <!-- RAW JSON (collapsed) -->
      <section class="adm-section">
        <button type="button" class="adm-raw__toggle" data-raw-toggle="demo">${state.rawOpen.demo ? '▼' : '▶'} ${esc(T('editor.raw_toggle'))}</button>
        ${state.rawOpen.demo && demo ? `<pre class="adm-raw">${esc(JSON.stringify(demo.payload, null, 2))}</pre>` : ''}
      </section>
    </div>
  `;
}

// ─── EDITOR (right-pane chat that drives the 12-agent dashboard suite) ────
function renderEditor() {
  const ed = state.editor;
  const messagesHtml = ed.messages.length === 0
    ? `<div class="adm-ed__empty">
         <p class="adm-ed__empty-eye">${esc(T('editor.empty.eye'))}</p>
         <h4 class="adm-ed__empty-h">${esc(T('editor.empty.heading'))}</h4>
         <p class="adm-ed__empty-sub">${esc(T('editor.empty.sub'))}</p>
       </div>`
    : ed.messages.map(renderMsg).join('');

  const quickHtml = getQuickPrompts().map(q =>
    `<button type="button" class="adm-ed__quick" data-quick="${esc(q.prompt)}">${esc(T(q.labelKey))}</button>`
  ).join('');

  return `
    <aside class="adm-editor" aria-label="Dashboard editor chat">
      <header class="adm-ed__head">
        <span class="adm-ed__eye">${esc(T('editor.title'))}</span>
        <span class="adm-ed__model">${esc(T('editor.model_tag'))}</span>
      </header>

      <div class="adm-ed__quicks" aria-label="Quick prompts">
        ${quickHtml}
      </div>

      <div class="adm-ed__messages" id="adm-ed-msgs">
        ${messagesHtml}
        ${ed.pending ? `<div class="adm-ed__msg adm-ed__msg--pending"><span class="adm-ed__dots"><span></span><span></span><span></span></span><span class="adm-ed__pending-label">${esc(T('editor.orchestrating'))}</span></div>` : ''}
      </div>

      ${ed.pendingImages.length ? `
        <div class="adm-ed__image-strip">
          ${ed.pendingImages.map((img, i) => `
            <div class="adm-ed__image-chip" title="${esc(img.name)}">
              <img src="${esc(img.dataUrl)}" alt="" />
              <button type="button" class="adm-ed__image-remove" data-remove-image="${i}" aria-label="Remove image">×</button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <form class="adm-ed__form" id="adm-ed-form">
        <textarea
          class="adm-ed__input"
          id="adm-ed-input"
          rows="2"
          placeholder="${esc(ed.pendingImages.length ? T('editor.placeholder_img') : T('editor.placeholder'))}"
          ${ed.pending ? 'disabled' : ''}
        >${esc(ed.input)}</textarea>
        <div class="adm-ed__form-actions">
          <label class="adm-ed__attach" title="${esc(T('editor.attach'))}" aria-label="${esc(T('editor.attach'))}" ${ed.pending ? 'aria-disabled="true"' : ''}>
            <input type="file" id="adm-ed-file" accept="image/*" multiple style="display:none;" ${ed.pending ? 'disabled' : ''} />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </label>
          <button type="submit" class="adm-ed__send" ${ed.pending ? 'disabled' : ''}>
            ${ed.pending ? '…' : esc(T('editor.send'))}
          </button>
        </div>
      </form>
    </aside>
  `;
}

function renderMsg(m) {
  if (m.role === 'user') {
    const imgThumbs = (m.images || []).map(img =>
      `<img src="${esc(img.dataUrl)}" alt="attached image" class="adm-ed__msg-img" />`
    ).join('');
    return `<div class="adm-ed__msg adm-ed__msg--user">
      ${imgThumbs ? `<div class="adm-ed__msg-imgs">${imgThumbs}</div>` : ''}
      ${m.content ? `<p>${esc(m.content)}</p>` : ''}
    </div>`;
  }
  if (m.role === 'system') {
    return `<div class="adm-ed__msg adm-ed__msg--system">
      <p>${esc(m.content)}</p>
    </div>`;
  }
  // assistant
  const specs = (m.specialists || []).map(s => `<span class="adm-ed__spec" title="${esc(s)}">${esc(prettyAgentName(s))}</span>`).join('');
  const errs = (m.errors && m.errors.length)
    ? `<p class="adm-ed__err">${esc(m.errors.length)} agent(s) failed: ${esc(m.errors.slice(0,1).join(' / '))}</p>`
    : '';
  const mainAgentBadge = m.used_main_agent
    ? `<div class="adm-ed__main-agent">
         <span class="adm-ed__main-agent-icon">◆</span>
         <span class="adm-ed__main-agent-label">${esc(T('editor.mainAgent'))}</span>
         <span class="adm-ed__main-agent-model">${esc(prettyModelName(m.main_agent_model))}</span>
       </div>`
    : '';
  return `<div class="adm-ed__msg adm-ed__msg--assistant${m.used_main_agent ? ' adm-ed__msg--main-agent' : ''}">
    ${mainAgentBadge}
    <p>${esc(m.content)}</p>
    ${specs ? `<div class="adm-ed__specs">${specs}</div>` : ''}
    ${errs}
  </div>`;
}

function prettyModelName(model) {
  if (!model) return '';
  if (/opus/i.test(model)) return 'Claude Opus 4.7';
  if (/sonnet/i.test(model)) return 'Claude Sonnet 4.6';
  if (/haiku/i.test(model)) return 'Claude Haiku 4.5';
  return model;
}

// Map snake_case agent IDs to short human labels so the chat surface reads
// like Claude instead of developer logging.
const AGENT_LABELS = {
  recommendations_generator: 'Recs',
  roi_calculator:            'ROI',
  kpi_designer:              'KPIs',
  headline_writer:           'Headline',
  insights_generator:        'Insights',
  graph_expert:              'Chart',
  pricing_strategist:        'Pricing',
  process_optimizer:         'Optims',
  activity_synthesizer:      'Activity',
  risk_analyzer:             'Risks',
  roadmap_architect:         'Roadmap',
  data_extractor:            'Data',
  section_manager:           'Sections',
  freeform_editor:           'Main agent'
};
function prettyAgentName(slug) {
  if (!slug) return '';
  if (AGENT_LABELS[slug]) return AGENT_LABELS[slug];
  // Fallback: turn `roi_calculator` → `Roi calculator`
  return String(slug)
    .replace(/_/g, ' ')
    .replace(/^./, c => c.toUpperCase());
}

async function runRowAction(id, action) {
  let endpoint, body;
  if (action === 'soft-delete') { endpoint = '/api/admin/delete-prospect'; body = { prospect_id: id, hard: false }; }
  else if (action === 'hard-delete') { endpoint = '/api/admin/delete-prospect'; body = { prospect_id: id, hard: true }; }
  else if (action === 'restore')     { endpoint = '/api/admin/restore-prospect'; body = { prospect_id: id }; }
  else return;

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      alert(`Action failed: ${data.error || r.status}`);
      return;
    }
    // Clear selection if we just deleted the open prospect
    if (state.selectedId === id) {
      state.selectedId = null;
      state.detail = null;
      state.editor.messages = [];
    }
    // Refresh list
    await loadList();
  } catch (e) {
    alert(`Network error: ${e.message}`);
  }
}

async function generateDashboard({ language, force } = {}) {
  if (state.generating || !state.selectedId) return;
  state.generating = true;
  state.generateError = null;
  render();
  try {
    const body = { prospect_id: state.selectedId };
    if (language) body.language = language;
    if (force)    body.force    = true;
    const r = await fetch('/api/admin/dashboard-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      state.generateError = data?.error || `HTTP ${r.status}`;
    } else {
      // Reload detail to surface the new demo block
      const id = state.selectedId;
      state.detail = null;
      render();
      const fresh = await apiGet(`/prospects?id=${encodeURIComponent(id)}`);
      if (state.selectedId === id) state.detail = fresh;
      state.editor.iframeBuster = Date.now();
    }
  } catch (e) {
    state.generateError = `Network error: ${e.message}`;
  }
  state.generating = false;
  render();
}

// Detect whether the currently-loaded prospect has artifacts in a language
// other than the admin chrome. Returns { summaryStale, dashboardStale, any,
// fromLang, toLang } so the UI can show a "Regenerar contenido" banner.
function detectLanguageDrift() {
  const detail = state.detail;
  const toLang = admLang();
  const empty = { summaryStale: false, dashboardStale: false, any: false, fromLang: null, toLang };
  if (!detail || !detail.prospect) return empty;

  const summaryLang = detail.summary?.summary_language || detail.prospect.language || null;
  const payloadLang = detail.demo?.payload?.language     || detail.prospect.language || null;
  const summaryStale   = !!detail.summary && summaryLang && summaryLang !== toLang;
  const dashboardStale = !!detail.demo    && payloadLang && payloadLang !== toLang;
  return {
    summaryStale,
    dashboardStale,
    any: summaryStale || dashboardStale,
    fromLang: summaryLang || payloadLang || null,
    toLang
  };
}

// Regenerate this prospect's AI summary AND / OR demo dashboard in the
// given language. Runs both in parallel when both are stale, then does a
// single fresh detail-refetch so the UI shows whichever artifact landed
// last (fixes the race where dashboard regen's internal refetch could grab
// the old summary).
async function regenerateProspectContent(newLang) {
  const drift = detectLanguageDrift();
  if (!drift.any) return;
  if (state.generating) return;
  if (!state.selectedId) return;

  const prospectId = state.selectedId;
  state.generating = true;
  state.generateError = null;
  // Track the target language + which artifacts are in flight so the UI
  // can show specific overlays ("Regenerating in EN…") on the affected
  // surfaces (summary card, demo iframe) instead of just a corner toast.
  state.regen = {
    lang: newLang,
    summary: !!drift.summaryStale,
    dashboard: !!drift.dashboardStale,
    startedAt: Date.now()
  };
  showAdminToast(T('admin.lang.regen_toast'));
  render();

  const tasks = [];
  if (drift.summaryStale) {
    tasks.push(
      fetch('/api/admin/regenerate-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospectId, language: newLang })
      }).then(r => r.json().catch(() => ({}))).catch(e => ({ ok: false, error: e?.message }))
    );
  }
  if (drift.dashboardStale) {
    tasks.push(
      fetch('/api/admin/dashboard-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospectId, language: newLang, force: true })
      }).then(r => r.json().catch(() => ({}))).catch(e => ({ ok: false, error: e?.message }))
    );
  }

  let failed = false;
  try {
    const results = await Promise.all(tasks);
    for (const r of results) {
      if (r && r.ok === false) failed = true;
    }
  } catch {
    failed = true;
  }

  // Refetch the detail ONCE, after both tasks have settled, so the UI
  // shows the latest persisted state regardless of which finished first.
  try {
    const fresh = await apiGet(`/prospects?id=${encodeURIComponent(prospectId)}`);
    if (state.selectedId === prospectId) state.detail = fresh;
    state.editor.iframeBuster = Date.now();
  } catch (e) {
    failed = true;
  }

  // Force the embedded demo iframe to reload from scratch. Changing the
  // `src` via render() works most of the time, but if the browser was in
  // the middle of a load when we rebuilt the DOM the new iframe element
  // can stay in the "Generating…" placeholder. An explicit reload on the
  // live iframe element after render guarantees a fresh demo-preview.js
  // init that picks up the new payload.
  requestAnimationFrame(() => {
    try {
      const iframe = document.querySelector('.adm-demo__frame');
      if (iframe && iframe.contentWindow) {
        // Reassign src with the latest buster — most reliable cross-browser
        // way to force a hard reload of an iframe.
        const base = iframe.src.split('?')[0];
        iframe.src = `${base}?internal=1&_t=${state.editor.iframeBuster}`;
      }
    } catch {}
  });

  state.generating = false;
  state.regen = null;
  render();
  if (failed) {
    showAdminToast(T('admin.lang.regen_error'), 'error');
  } else {
    showAdminToast(T('admin.lang.regen_done'), 'ok');
  }
}

// Lightweight bottom-right toast. Stacks multiple briefly.
function showAdminToast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `adm-toast adm-toast--${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  // Animate in
  requestAnimationFrame(() => el.classList.add('is-shown'));
  setTimeout(() => {
    el.classList.remove('is-shown');
    setTimeout(() => el.remove(), 240);
  }, kind === 'error' ? 4500 : 2400);
}

// Image helper — turn a File into { name, mediaType, dataUrl, base64 }
function fileToImagePayload(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Not an image'));
    if (file.size > 5 * 1024 * 1024) return reject(new Error('Image too large (max 5MB)'));
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64  = String(dataUrl).split(',')[1] || '';
      resolve({ name: file.name, mediaType: file.type, dataUrl, base64 });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addImagesFromFileList(fileList) {
  const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
  for (const f of files) {
    try {
      const payload = await fileToImagePayload(f);
      state.editor.pendingImages.push(payload);
    } catch (e) {
      alert(`${f.name}: ${e.message}`);
    }
  }
  render();
}

async function sendEdit(prompt) {
  const text = String(prompt || '').trim();
  const images = state.editor.pendingImages.slice();
  // Allow send if there's text OR at least one image
  if ((!text && images.length === 0) || state.editor.pending) return;

  state.editor.messages.push({
    role: 'user',
    content: text,
    images: images.map(img => ({ dataUrl: img.dataUrl })), // preview-only data for UI
    ts: Date.now()
  });
  state.editor.input = '';
  state.editor.pendingImages = [];
  state.editor.pending = true;
  render();
  scrollEditorToBottom();

  try {
    const r = await fetch('/api/admin/dashboard-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prospect_id: state.selectedId,
        prompt: text,
        // Send each image as { media_type, data } per Anthropic vision API shape
        images: images.map(img => ({ media_type: img.mediaType, data: img.base64 }))
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      state.editor.messages.push({
        role: 'system',
        content: data?.error || `HTTP ${r.status}`,
        ts: Date.now()
      });
    } else {
      state.editor.messages.push({
        role: 'assistant',
        content: data.explain || 'Done.',
        specialists: data.specialists_used || [],
        errors: data.errors || [],
        used_main_agent: !!data.used_main_agent,
        main_agent_model: data.main_agent_model || null,
        models_used: data.models_used || {},
        ts: Date.now()
      });
      // Update local state so the iframe metadata bar shows "edited" + new timestamp
      if (state.detail?.demo) {
        state.detail.demo.payload      = data.payload;
        state.detail.demo.edited       = true;
        state.detail.demo.generated_at = new Date().toISOString();
      }
      // Refresh the iframe by bumping the cache-buster
      state.editor.iframeBuster = Date.now();
    }
  } catch (e) {
    state.editor.messages.push({ role: 'system', content: `Network error: ${e.message}`, ts: Date.now() });
  }

  state.editor.pending = false;
  render();
  scrollEditorToBottom();
  // Belt-and-suspenders iframe reload — re-render alone isn't always enough when
  // the iframe URL only differs by query string (some browsers cache aggressively).
  // Force-set src AFTER render so the iframe definitely reloads.
  setTimeout(() => {
    const iframe = document.querySelector('.adm-demo__frame');
    if (iframe) {
      const url = new URL(iframe.src, location.origin);
      url.searchParams.set('_t', String(Date.now()));
      iframe.src = url.toString();
    }
  }, 50);
}

function scrollEditorToBottom() {
  const el = document.getElementById('adm-ed-msgs');
  if (el) el.scrollTop = el.scrollHeight;
}

// ─── EVENTS ────────────────────────────────────────────────────────────────
function bindEvents() {
  const search = document.getElementById('adm-search');
  if (search) {
    let debounce;
    search.addEventListener('input', (e) => {
      clearTimeout(debounce);
      state.filter.search = e.target.value;
      // Just re-render list, don't refetch
      debounce = setTimeout(() => render(), 80);
    });
  }

  document.querySelectorAll('.adm-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.status || null;
      state.filter.status = v;
      loadList();
    });
  });

  document.querySelectorAll('.adm-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't fire row-click when the delete/restore icons are clicked
      if (e.target.closest('[data-action]')) return;
      const id = row.dataset.id;
      if (id && id !== state.selectedId) loadDetail(id);
      else if (id === state.selectedId) loadDetail(id);
    });
  });

  // Delete (soft / hard) + restore actions on each row
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;

      // Costs modal triggers (have data-prospect-id, not data-id)
      if (action === 'open-costs') {
        const pid = btn.dataset.prospectId || null;
        await openCostsModal(pid || null);
        return;
      }
      if (action === 'close-costs') {
        closeCostsModal();
        return;
      }
      // Manual "regenerate prospect content in current language" button on
      // the detail header — runs the same regen pipeline the lang toggle
      // would have triggered.
      if (action === 'regen-content') {
        await regenerateProspectContent(admLang());
        return;
      }

      const id = btn.dataset.id;
      if (!id) return;
      const messages = {
        'soft-delete': T('confirm.soft'),
        'hard-delete': T('confirm.hard'),
        'restore': null
      };
      if (messages[action] && !confirm(messages[action])) return;
      await runRowAction(id, action);
    });
  });

  const back = document.getElementById('adm-back');
  if (back) back.addEventListener('click', () => {
    state.selectedId = null;
    state.detail = null;
    render();
  });

  document.querySelectorAll('[data-raw-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.rawToggle;
      state.rawOpen[k] = !state.rawOpen[k];
      render();
    });
  });

  // Generate-dashboard button (shown when prospect has no demo yet)
  const genBtn = document.getElementById('adm-generate-btn');
  if (genBtn) {
    genBtn.addEventListener('click', generateDashboard);
  }

  // Logout
  const logoutBtn = document.getElementById('adm-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  // EN/ES toggle — persists to localStorage + re-renders. When a prospect
  // detail is open AND its content was generated in the OTHER language,
  // automatically regenerates both the AI summary AND the demo dashboard
  // in the new language. No blocking confirm — a non-blocking toast +
  // spinner makes it obvious work is happening; the explicit
  // "Regenerar contenido" button on the detail header is the manual
  // fallback if the auto-regen is skipped for any reason.
  document.querySelectorAll('[data-set-lang]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newLang = btn.dataset.setLang;
      const oldLang = admLang();
      setAdmLang(newLang);
      render();
      if (newLang === oldLang) return;
      // Fire-and-forget — the helper is responsible for its own UI state.
      regenerateProspectContent(newLang);
    });
  });

  // Editor: quick-prompt chips
  document.querySelectorAll('[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => sendEdit(btn.dataset.quick));
  });

  // Editor: input mirror + form submit
  const edInput = document.getElementById('adm-ed-input');
  if (edInput) {
    edInput.addEventListener('input', (e) => { state.editor.input = e.target.value; });
    edInput.addEventListener('keydown', (e) => {
      // Cmd/Ctrl+Enter submits
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        sendEdit(edInput.value);
      }
    });
    // Restore focus after re-render so the user can keep typing
    if (state.editor._focus) {
      edInput.focus();
      try { edInput.setSelectionRange(state.editor.input.length, state.editor.input.length); } catch {}
      state.editor._focus = false;
    }
  }
  const edForm = document.getElementById('adm-ed-form');
  if (edForm) {
    edForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = document.getElementById('adm-ed-input');
      sendEdit(inp ? inp.value : state.editor.input);
    });
  }

  // File attach (click paperclip)
  const fileInput = document.getElementById('adm-ed-file');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      addImagesFromFileList(e.target.files);
      e.target.value = ''; // reset so the same file can be re-added
    });
  }

  // Remove image from pending
  document.querySelectorAll('[data-remove-image]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = parseInt(btn.dataset.removeImage, 10);
      state.editor.pendingImages.splice(i, 1);
      render();
    });
  });

  // Drag-and-drop onto the editor panel
  const editorPanel = document.querySelector('.adm-editor');
  if (editorPanel && !editorPanel._dndBound) {
    editorPanel._dndBound = true;
    editorPanel.addEventListener('dragover', (e) => {
      if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
        e.preventDefault();
        editorPanel.classList.add('is-dragover');
      }
    });
    editorPanel.addEventListener('dragleave', () => editorPanel.classList.remove('is-dragover'));
    editorPanel.addEventListener('drop', (e) => {
      e.preventDefault();
      editorPanel.classList.remove('is-dragover');
      addImagesFromFileList(e.dataTransfer?.files);
    });
  }

  // Paste images from clipboard (Cmd/Ctrl+V into the textarea)
  if (edInput && !edInput._pasteBound) {
    edInput._pasteBound = true;
    edInput.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []).filter(it => it.kind === 'file' && it.type.startsWith('image/'));
      if (!items.length) return;
      e.preventDefault();
      const files = items.map(it => it.getAsFile()).filter(Boolean);
      addImagesFromFileList(files);
    });
  }
}

// ─── DEEP-LINK (?prospect=<id> or #prospect=<id>) ───────────────────────────
function getInitialId() {
  const sp = new URLSearchParams(location.search);
  if (sp.get('prospect')) return sp.get('prospect');
  const hash = location.hash.replace(/^#/, '');
  const hp = new URLSearchParams(hash);
  return hp.get('prospect') || null;
}

// ─── BOOT ─────────────────────────────────────────────────────────────────
(async function init() {
  render();
  await loadList();
  // Kick off usage overview in parallel — populates the topbar spend pill.
  loadUsageOverview().catch(() => {});
  const id = getInitialId();
  if (id) loadDetail(id);
})();

// Global ESC handler — close cost modal first if open.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.costs.open) {
    closeCostsModal();
  }
});
