// ─── IMPORTS ───────────────────────────────────────────────────────────────
import { getLang, setLang, t, localize } from './i18n.js';
import { api } from './api.js';
import { animate, stagger } from './vendor/anime.esm.js';

// ─── REDUCED MOTION ──────────────────────────────────────────────────────────
const RM = window.matchMedia('(prefers-reduced-motion: reduce)');

// Track previous question ID to detect real question changes vs. re-renders
// caused by typing or chip selection (where we must NOT re-trigger entrance).
let _prevQuestionId = null;

// ─── DEMO DATA ─────────────────────────────────────────────────────────────
// Self-contained copy of the 10 question definitions for demo mode.
// Shape mirrors api/_lib/questions.js — backend never called in demo.
const DEMO_QUESTIONS = [
  {
    id: 'Q1', section: 1,
    prompt: { en: 'What kind of business are you running?', es: '¿Qué tipo de negocio diriges?' },
    inputs: [
      { name: 'industry', type: 'select', required: true, options: [
        { value: 'distribucion', label: { en: 'Distribution', es: 'Distribución' } },
        { value: 'retail',       label: { en: 'Retail',       es: 'Retail' } },
        { value: 'manufactura',  label: { en: 'Manufacturing', es: 'Manufactura' } },
        { value: 'servicios',    label: { en: 'Services',      es: 'Servicios' } },
        { value: 'logistica',    label: { en: 'Logistics',     es: 'Logística' } },
        { value: 'salud',        label: { en: 'Healthcare',    es: 'Salud' } },
        { value: 'construccion', label: { en: 'Construction',  es: 'Construcción' } },
        { value: 'educacion',    label: { en: 'Education',     es: 'Educación' } },
        { value: 'other',        label: { en: 'Other',         es: 'Otro' } }
      ]},
      { name: 'headcount', type: 'select', required: true, options: [
        { value: 'solo',   label: { en: 'Just me', es: 'Solo yo' } },
        { value: '1-10',   label: '1–10' },
        { value: '11-50',  label: '11–50' },
        { value: '51-200', label: '51–200' },
        { value: '200+',   label: '200+' }
      ]}
    ]
  },
  {
    id: 'Q2', section: 1,
    prompt: { en: 'In one sentence — what does your company actually do day-to-day?', es: 'En una oración: ¿qué hace tu empresa día a día?' },
    inputs: [{ name: 'description', type: 'textarea', maxLength: 280, required: true, placeholder: { en: 'e.g., We distribute consumer goods to 380 bodegas in Lima — daily routes, weekly invoicing.', es: 'ej., Distribuimos productos a 380 bodegas en Lima — rutas diarias, facturación semanal.' } }]
  },
  {
    id: 'Q3', section: 2,
    prompt: { en: "What's the most painful manual process you run every week?", es: '¿Cuál es el proceso manual más doloroso que ejecutas cada semana?' },
    inputs: [
      { name: 'process', type: 'text', required: true },
      { name: 'chips', type: 'chips', options: [
        { value: 'reconciling', label: { en: 'Reconciling sales',   es: 'Conciliar ventas' } },
        { value: 'reports',     label: { en: 'Building reports',    es: 'Armar reportes' } },
        { value: 'followups',   label: { en: 'Following up clients', es: 'Hacer seguimientos' } },
        { value: 'inventory',   label: { en: 'Inventory counts',    es: 'Inventarios' } },
        { value: 'approvals',   label: { en: 'Approvals chain',     es: 'Cadena de aprobaciones' } },
        { value: 'payroll',     label: { en: 'Payroll',             es: 'Planilla' } },
        { value: 'other',       label: { en: 'Other',               es: 'Otro' } }
      ]}
    ],
    followup_strategy: 'ai_one_of_three'
  },
  {
    id: 'Q4', section: 2,
    prompt: { en: 'How many hours per week does that eat — you + your team combined?', es: '¿Cuántas horas a la semana te consume — tú + tu equipo combinados?' },
    inputs: [{ name: 'hours_range', type: 'chips', required: true, options: [
      { value: '1-5',   label: '1–5h' },
      { value: '5-10',  label: '5–10h' },
      { value: '10-20', label: '10–20h' },
      { value: '20-40', label: '20–40h' },
      { value: '40+',   label: '40+h' }
    ]}]
  },
  {
    id: 'Q5', section: 3,
    prompt: { en: 'What tools touch this process today?', es: '¿Qué herramientas tocan este proceso hoy?' },
    inputs: [{ name: 'tools', type: 'multiselect', options: [
      { value: 'excel',    label: 'Excel / Google Sheets' },
      { value: 'erp',      label: 'ERP', extra: { name: 'erp_name', type: 'text', placeholder: 'Which?' } },
      { value: 'crm',      label: 'CRM', extra: { name: 'crm_name', type: 'text', placeholder: 'Which?' } },
      { value: 'whatsapp', label: 'WhatsApp' },
      { value: 'email',    label: 'Email' },
      { value: 'paper',    label: { en: 'Paper', es: 'Papel' } },
      { value: 'custom',   label: { en: 'Custom internal tool', es: 'Herramienta interna' } },
      { value: 'head',     label: { en: 'Just my head', es: 'Mi cabeza' } },
      { value: 'other',    label: { en: 'Other', es: 'Otro' } }
    ]}]
  },
  {
    id: 'Q6', section: 3,
    prompt: { en: 'Where does the data actually live?', es: '¿Dónde vive realmente la información?' },
    inputs: [{ name: 'data_state', type: 'select', required: true, options: [
      { value: 'spreadsheets_many',    label: { en: 'Spreadsheets (multiple files)',    es: 'Spreadsheets (varios archivos)' } },
      { value: 'systems_disconnected', label: { en: "Multiple systems that don't talk", es: 'Varios sistemas que no se hablan' } },
      { value: 'one_inconsistent',     label: { en: 'One ERP/CRM, inconsistent data',   es: 'Un ERP/CRM, datos inconsistentes' } },
      { value: 'paper_whatsapp',       label: { en: 'Paper / WhatsApp screenshots',     es: 'Papel / capturas de WhatsApp' } },
      { value: 'custom_db',            label: { en: 'Custom database',                  es: 'Base de datos propia' } },
      { value: 'mix',                  label: { en: 'Mix of everything',                es: 'Mezcla de todo' } }
    ]}],
    followup_strategy: 'ai_if_systems_disconnected'
  },
  {
    id: 'Q7', section: 4,
    prompt: { en: 'If we could fix ONE thing in the next 90 days, what would have the biggest impact?', es: 'Si pudiéramos arreglar UNA cosa en los próximos 90 días, ¿qué tendría el mayor impacto?' },
    inputs: [
      { name: 'fix', type: 'text', required: true },
      { name: 'chips', type: 'chips', options: [
        { value: 'kpis',       label: { en: 'See real-time KPIs',       es: 'Ver KPIs en tiempo real' } },
        { value: 'reports',    label: { en: 'Eliminate manual reports',  es: 'Eliminar reportes manuales' } },
        { value: 'approvals',  label: { en: 'Speed up approvals',        es: 'Acelerar aprobaciones' } },
        { value: 'errors',     label: { en: 'Reduce errors',             es: 'Reducir errores' } },
        { value: 'time',       label: { en: 'Free up my time',           es: 'Liberar mi tiempo' } },
        { value: 'onboarding', label: { en: 'Onboard clients faster',    es: 'Onboarding más rápido' } },
        { value: 'other',      label: { en: 'Other',                     es: 'Otro' } }
      ]}
    ],
    followup_strategy: 'ai_always'
  },
  {
    id: 'Q8', section: 4,
    prompt: { en: 'What does success look like in numbers?', es: '¿Cómo se ve el éxito en números?' },
    inputs: [
      { name: 'metric', type: 'text', required: true, placeholder: { en: 'e.g., weekly close time', es: 'ej. tiempo de cierre semanal' } },
      { name: 'target', type: 'text', required: true, placeholder: { en: 'e.g., 3 days → 4 hours',  es: 'ej. 3 días → 4 horas' } }
    ]
  },
  {
    id: 'Q9', section: 5,
    prompt: { en: 'Your role and who else needs to be in the room.', es: 'Tu rol y quién más necesita estar en la sala.' },
    inputs: [
      { name: 'role', type: 'select', required: true, options: [
        { value: 'ceo',     label: 'CEO' },
        { value: 'coo',     label: 'COO' },
        { value: 'ops',     label: { en: 'Ops Director',    es: 'Director de Operaciones' } },
        { value: 'finance', label: { en: 'Finance Manager', es: 'Gerente Financiero' } },
        { value: 'other',   label: { en: 'Other',           es: 'Otro' } }
      ]},
      { name: 'decision_unit', type: 'select', required: true, options: [
        { value: 'me',        label: { en: 'Just me',         es: 'Solo yo' } },
        { value: 'cofounder', label: { en: 'Me + co-founder', es: 'Yo + co-founder' } },
        { value: 'ops_team',  label: { en: 'Me + ops team',   es: 'Yo + equipo ops' } },
        { value: 'finance',   label: { en: 'Me + finance',    es: 'Yo + finanzas' } },
        { value: 'exec',      label: { en: 'Me + exec team',  es: 'Yo + equipo ejecutivo' } }
      ]}
    ]
  },
  {
    id: 'Q10', section: 5,
    prompt: { en: 'Pick a discovery call slot and best phone.', es: 'Elige un horario para la llamada de descubrimiento y un teléfono.' },
    inputs: [
      { name: 'calendly_url', type: 'calendly' },
      { name: 'phone',        type: 'phone', required: true },
      { name: 'whatsapp_ok',  type: 'checkbox', default: true, label: { en: 'OK to follow up via WhatsApp', es: 'OK contactarme por WhatsApp' } }
    ]
  }
];

// Demo follow-ups keyed by question id
const DEMO_FOLLOWUPS = {
  Q3: {
    id: 'Q3.1',
    is_followup: true,
    prompt: { en: "Who's running it today?", es: '¿Quién lo hace hoy?' },
    inputs: [{ name: 'owner', type: 'text' }]
  },
  Q7: {
    id: 'Q7.1',
    is_followup: true,
    prompt: { en: "What number would that move? (revenue, hours, error rate, etc.)", es: '¿Qué número movería eso? (ingresos, horas, tasa de error, etc.)' },
    inputs: [{ name: 'impact', type: 'text' }]
  }
};

// ─── SECTION METADATA ──────────────────────────────────────────────────────
const SECTIONS = [
  { id: 1, labelKey: 'profile.section.business',    anchors: ['Q1', 'Q2'] },
  { id: 2, labelKey: 'profile.section.operations',  anchors: ['Q3', 'Q4'] },
  { id: 3, labelKey: 'profile.section.tools',       anchors: ['Q5', 'Q6'] },
  { id: 4, labelKey: 'profile.section.goals',       anchors: ['Q7', 'Q8'] },
  { id: 5, labelKey: 'profile.section.you',         anchors: ['Q9', 'Q10'] }
];

// ─── STATE MACHINE ─────────────────────────────────────────────────────────
const state = {
  phase: 'landing',            // 'landing' | 'wizard' | 'gate' | 'building' | 'redirecting'
  language: getLang(),
  prospect_id: null,
  current_question: null,      // the Q being asked (full question object)
  followup_question: null,     // AI follow-up question when present
  followup_answered: false,    // whether the follow-up has been filled
  answered_ids: [],            // list of anchor question IDs completed
  is_demo: new URLSearchParams(location.search).has('demo'),
  utm: {},                     // captured UTM params
  calendly_booked: false,      // true after Calendly fires event_scheduled
  loading: false               // async op in flight
};

// ─── UTM CAPTURE ───────────────────────────────────────────────────────────
(function captureUtm() {
  const sp = new URLSearchParams(location.search);
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(k => {
    if (sp.has(k)) state.utm[k] = sp.get(k);
  });
})();

// ─── HELPERS ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function el(tag, attrs = {}, ...children) {
  const elem = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') elem.className = v;
    else if (k.startsWith('on') && typeof v === 'function') elem.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) elem.setAttribute(k, '');
    else if (v !== false && v !== null && v !== undefined) elem.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    if (typeof child === 'string' || typeof child === 'number') elem.appendChild(document.createTextNode(String(child)));
    else elem.appendChild(child);
  }
  return elem;
}

// Get the section number for a question id (handles follow-ups like Q3.1)
function sectionOf(qid) {
  const base = String(qid).split('.')[0];
  const q = DEMO_QUESTIONS.find(q => q.id === base);
  return q?.section ?? 1;
}

// Count how many anchors are completed per section
function sectionProgress() {
  return SECTIONS.map(sec => sec.anchors.filter(aid => state.answered_ids.includes(aid)).length);
}

// Which section is currently active
function activeSection() {
  if (!state.current_question) return 1;
  return sectionOf(state.current_question.id);
}

// SVG check mark for multiselect
const SVG_CHECK = `<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="1.5,6 5,9.5 10.5,2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ─── LANG TOGGLE ───────────────────────────────────────────────────────────
function buildLangToggle(darkMode = false) {
  const lang = getLang();
  const wrap = el('div', { class: `disc-langtoggle${darkMode ? ' disc-langtoggle--on-dark' : ''}`, role: 'group', 'aria-label': 'Language' });

  const enBtn = el('button', {
    class: `disc-langtoggle__btn${lang === 'en' ? ' disc-langtoggle__btn--active' : ''}`,
    type: 'button',
    'aria-pressed': lang === 'en' ? 'true' : 'false',
    onClick: () => { setLang('en'); state.language = 'en'; render(); }
  }, 'EN');

  const sep = el('span', { class: 'disc-langtoggle__sep', 'aria-hidden': 'true' }, '|');

  const esBtn = el('button', {
    class: `disc-langtoggle__btn${lang === 'es' ? ' disc-langtoggle__btn--active' : ''}`,
    type: 'button',
    'aria-pressed': lang === 'es' ? 'true' : 'false',
    onClick: () => { setLang('es'); state.language = 'es'; render(); }
  }, 'ES');

  wrap.append(enBtn, sep, esBtn);
  return wrap;
}

// ─── RENDER DISPATCHER ─────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = '';

  switch (state.phase) {
    case 'landing':    renderLanding(root);   break;
    case 'wizard':     renderWizard(root);    break;
    case 'gate':       renderWizard(root); renderGate(root); break;
    case 'building':
    case 'redirecting': renderBuilding(root); break;
    default:           renderLanding(root);
  }

  if (state.is_demo) renderDemoBadge();

  // Post-render animation hooks
  const currentQId = state.current_question?.id ?? null;
  const questionChanged = currentQId !== _prevQuestionId;
  _prevQuestionId = currentQId;

  if (!RM.matches) {
    if (state.phase === 'wizard' || state.phase === 'gate') {
      runWizardAnimation(questionChanged);
    }
    if (state.phase === 'building' || state.phase === 'redirecting') {
      runBuildingAnimation();
    }
    if (state.phase === 'landing') {
      runLandingAnimation();
    }
  }
}

// ─── LANDING ENTRANCE ANIMATION ────────────────────────────────────────────
let _landingAnimated = false;
function runLandingAnimation() {
  if (_landingAnimated || RM.matches) return;
  _landingAnimated = true;
  requestAnimationFrame(() => {
    animate('.disc-landing__eyebrow', {
      opacity: [0, 1], translateY: [10, 0],
      duration: 380, ease: 'outCubic'
    });
    animate('.disc-landing__heading', {
      opacity: [0, 1], translateY: [16, 0],
      duration: 520, delay: 80, ease: 'outCubic'
    });
    animate('.disc-landing__subline', {
      opacity: [0, 1], translateY: [10, 0],
      duration: 420, delay: 180, ease: 'outCubic'
    });
    animate('.disc-landing__meta, .disc-landing__actions', {
      opacity: [0, 1], translateY: [8, 0],
      duration: 380,
      delay: stagger(60, { start: 280 }),
      ease: 'outCubic'
    });
  });
}

// ─── WIZARD CARD ANIMATION ─────────────────────────────────────────────────
// Called after every wizard render. Only slides the card if the question changed.
// Follow-up block slides in from the right when it first appears.
function runWizardAnimation(questionChanged) {
  if (RM.matches) return;
  requestAnimationFrame(() => {
    if (questionChanged) {
      // Main question card: fade + slide up
      animate('.disc-card', {
        opacity:    [0, 1],
        translateY: [24, 0],
        duration: 360,
        ease: 'outQuart'
      });
      // Inputs inside card: stagger
      animate('.disc-card__inputs > *, .disc-card__actions', {
        opacity:    [0, 1],
        translateY: [8, 0],
        duration: 280,
        delay: stagger(60, { start: 120 }),
        ease: 'outCubic'
      });
    }

    // Follow-up: always animate its entrance (slides from right)
    if (state.followup_question) {
      animate('.disc-followup', {
        opacity:    [0, 1],
        translateX: ['100%', '0%'],
        duration: 320,
        ease: 'outQuart'
      });
    }

    // Gate modal entrance (when gate phase first renders)
    if (state.phase === 'gate') {
      animate('.disc-gate__panel', {
        opacity:    [0, 1],
        translateY: [16, 0],
        duration: 500,
        ease: 'outQuart'
      });
      animate('.disc-gate__panel .disc-field, .disc-gate__panel .disc-error, .disc-gate__panel .disc-card__actions, .disc-gate__privacy', {
        opacity:    [0, 1],
        translateY: [8, 0],
        duration: 320,
        delay: stagger(70, { start: 220 }),
        ease: 'outCubic'
      });
    }
  });
}

// ─── BUILDING SCREEN ANIMATION ─────────────────────────────────────────────
function runBuildingAnimation() {
  if (RM.matches) return;
  // Heading pulse (breathing effect while building)
  requestAnimationFrame(() => {
    animate('.disc-loading__heading', {
      opacity:  [0.6, 1],
      duration: 1400,
      ease: 'inOutSine',
      loop: true,
      alternate: true
    });
    // Dots stagger pulse
    animate('.disc-loading__dots span', {
      opacity:  [0.2, 1],
      scale:    [0.8, 1.2],
      duration: 500,
      loop: true,
      alternate: true,
      delay: stagger(140)
    });
  });
}

// ─── LANDING SCREEN ────────────────────────────────────────────────────────
function renderLanding(root) {
  const section = el('section', { class: 'disc-landing', 'aria-labelledby': 'landing-heading' });

  // Top-bar removed in V2 — the global top nav (in index.html) now owns the brand.

  // Inner content
  const inner = el('div', { class: 'disc-landing__inner' });
  const eyebrow = el('p', { class: 'disc-landing__eyebrow' }, t('wizard.intro.eyebrow'));

  const heading = el('h1', { class: 'disc-landing__heading disc-h1', id: 'landing-heading' });
  heading.append(
    document.createTextNode(t('wizard.intro.heading.before')),
    el('em', {}, t('wizard.intro.heading.em')),
    document.createTextNode(t('wizard.intro.heading.after'))
  );

  const subline = el('p', { class: 'disc-landing__subline disc-body' }, t('wizard.intro.subline'));

  const meta = el('div', { class: 'disc-landing__meta', 'aria-hidden': 'true' });
  const metaDot = () => { const i = el('i'); return i; };
  const m1 = el('span', {}); m1.append(metaDot()); m1.append(document.createTextNode(t('wizard.section_of', { n: '10' }).replace('Section', '10').replace('Sección', '10')));

  // Simpler: hardcode the meta labels per lang
  const lang = getLang();
  const metaItems = lang === 'es'
    ? ['10 preguntas', '~5 minutos', 'Salta las que quieras']
    : ['10 questions', '~5 minutes', 'Skip any'];
  metaItems.forEach(label => {
    const span = el('span', {});
    const dot = el('i');
    span.append(dot, document.createTextNode(label));
    meta.append(span);
  });

  const actions = el('div', { class: 'disc-landing__actions' });
  const startBtn = el('button', {
    class: 'disc-btn disc-btn--primary disc-landing__start',
    type: 'button',
    onClick: handleStart
  }, t('wizard.start'), document.createTextNode(' →'));
  actions.append(startBtn);

  inner.append(eyebrow, heading, subline, meta, actions);
  section.append(inner);

  // Footnote (also hosts the language toggle now that the in-landing topbar is gone)
  const footnote = el('div', { class: 'disc-landing__footnote' });
  const fnLeft = el('span', {}, lang === 'es' ? '// DESCUBRIMIENTO · V01' : '// DISCOVERY · V01');
  const fnRight = buildLangToggle(false);
  footnote.append(fnLeft, fnRight);
  section.append(footnote);

  root.append(section);
}

// ─── WIZARD SCREEN ─────────────────────────────────────────────────────────
function renderWizard(root) {
  const q = state.current_question;
  if (!q) return;

  const wizard = el('div', { class: 'disc-wizard' });

  // ── SIDEBAR
  const sidebar = buildSidebar();
  wizard.append(sidebar);

  // ── CONTENT PANE
  const content = el('div', { class: 'disc-wizard__content' });

  // Header (lang toggle + progress glyph)
  const header = el('div', { class: 'disc-wizard__header' });
  const prog = buildProgressGlyph();
  header.append(prog, buildLangToggle(false));
  content.append(header);

  // Main card
  const cardWrap = el('div', { style: 'display:flex;flex-direction:column;gap:16px;align-self:center;justify-self:center;width:100%;max-width:720px;' });
  const card = buildQuestionCard(q, false);
  cardWrap.append(card);

  // Follow-up block (if present)
  if (state.followup_question) {
    const followup = buildFollowupBlock(state.followup_question);
    cardWrap.append(followup);
  }

  content.append(cardWrap);
  wizard.append(content);
  root.append(wizard);
}

function buildSidebar() {
  const sidebar = el('aside', { class: 'disc-sidebar', 'aria-label': 'Wizard progress' });

  // Brand removed in V2 — global top nav (in index.html) owns the brand mark.

  const eyebrow = el('p', { class: 'disc-sidebar__eyebrow' }, t('wizard.intro.eyebrow'));

  const nav = el('nav', { class: 'disc-sidebar__nav', 'aria-label': 'Sections' });
  const progress = sectionProgress();
  const active = activeSection();

  SECTIONS.forEach((sec, i) => {
    const done = progress[i] === sec.anchors.length;
    const isActive = sec.id === active;
    const isUpcoming = sec.id > active;

    let stateClass = 'disc-sidebar__item';
    if (isActive) stateClass += ' disc-sidebar__item--active';
    else if (done) stateClass += ' disc-sidebar__item--done';
    else if (isUpcoming) stateClass += ' disc-sidebar__item--upcoming';

    const item = el('div', {
      class: stateClass,
      role: 'listitem',
      'aria-current': isActive ? 'step' : undefined
    });

    const dot = el('span', { class: 'disc-sidebar__item__dot', 'aria-hidden': 'true' });
    const labelWrap = el('span', { class: 'disc-sidebar__item__label' });
    const num = el('span', { class: 'disc-sidebar__item__num' }, String(sec.id).padStart(2, '0'));
    const label = el('span', {}, t(sec.labelKey));
    labelWrap.append(num, label);

    // Completed anchors sub-label
    if (done && !isActive) {
      const sub = el('span', { class: 'disc-sidebar__item__sub' }, t('wizard.section_of', { n: sec.id }) + ' — done');
    }

    item.append(dot, labelWrap);
    nav.append(item);
  });

  sidebar.append(eyebrow, nav);

  // Footer
  const footer = el('div', { class: 'disc-sidebar__footer' });
  const row = el('div', { class: 'disc-sidebar__footer__row' });
  const totalAnswered = state.answered_ids.filter(id => !id.includes('.')).length;
  row.append(document.createTextNode('Progress '));
  const bold = el('b', {}, `${totalAnswered} / 10`);
  row.append(bold);
  footer.append(row);
  sidebar.append(footer);

  return sidebar;
}

function buildProgressGlyph() {
  const q = state.current_question;
  if (!q) return el('div', {});

  const anchorIds = ['Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9','Q10'];
  const currentIdx = anchorIds.indexOf(q.is_followup ? q.id.split('.')[0] : q.id);

  const wrap = el('div', { class: 'disc-wizard__progress-glyph', 'aria-label': `Question ${currentIdx + 1} of 10` });
  wrap.innerHTML = '';

  anchorIds.forEach((id, i) => {
    const isAnswered = state.answered_ids.includes(id);
    const isCurrent = i === currentIdx;
    if (isCurrent) {
      const b = el('b', {}, '█');
      wrap.append(b);
    } else if (isAnswered) {
      const b = el('b', {}, '▪');
      wrap.append(b);
    } else {
      const span = el('i', {}, '░');
      wrap.append(span);
    }
  });

  const caption = el('span', { class: 'disc-wizard__progress-caption' },
    `${currentIdx + 1} / 10`);
  wrap.append(caption);

  return wrap;
}

// ─── QUESTION CARD ─────────────────────────────────────────────────────────
function buildQuestionCard(q, isFollowupCard) {
  const sec = SECTIONS.find(s => s.id === sectionOf(q.id)) ?? SECTIONS[0];
  const card = el('article', { class: 'disc-card' });

  // Eyebrow
  const eyebrow = el('p', { class: 'disc-card__eyebrow' });
  const secLabel = t(sec.labelKey);
  eyebrow.textContent = `// SECTION ${sec.id} OF 5 · ${secLabel.toUpperCase()}`;
  card.append(eyebrow);

  // Prompt
  const prompt = el('h2', { class: 'disc-card__prompt disc-h2' }, localize(q.prompt));
  card.append(prompt);

  // Inputs
  const inputs = el('div', { class: 'disc-card__inputs' });
  buildInputs(q, inputs);
  card.append(inputs);

  // Actions
  const actions = buildCardActions(q);
  card.append(actions);

  return card;
}

// ─── INPUT RENDERING ───────────────────────────────────────────────────────
function buildInputs(q, container) {
  const answers = getAnswerStore(q.id);

  q.inputs.forEach(inp => {
    switch (inp.type) {
      case 'select':      buildSelect(inp, answers, container);      break;
      case 'text':        buildText(inp, answers, container);        break;
      case 'textarea':    buildTextarea(inp, answers, container);    break;
      case 'chips': {
        // Chips that are suggestions for an adjacent text field
        const isLinked = q.inputs.some(i => i.type === 'text' || i.type === 'textarea');
        if (isLinked) buildLinkedChips(inp, answers, container, q);
        else          buildSingleSelectChips(inp, answers, container);
        break;
      }
      case 'multiselect': buildMultiselect(inp, answers, container); break;
      case 'phone':       buildPhone(inp, answers, container);       break;
      case 'checkbox':    buildCheckbox(inp, answers, container);    break;
      case 'calendly':    buildCalendly(container);                  break;
    }
  });
}

// Per-question ephemeral answer store (lives in state during the session)
const _answerCache = {};

function getAnswerStore(qid) {
  if (!_answerCache[qid]) _answerCache[qid] = {};
  return _answerCache[qid];
}

function buildSelect(inp, answers, container) {
  const field = el('div', { class: 'disc-field' });
  if (inp.label) {
    const label = el('label', { class: 'disc-field__label', for: `inp-${inp.name}` }, localize(inp.label));
    field.append(label);
  }
  const select = el('select', {
    class: 'disc-select',
    id: `inp-${inp.name}`,
    name: inp.name,
    required: inp.required ? true : undefined
  });

  const defaultOpt = el('option', { value: '' });
  defaultOpt.textContent = getLang() === 'es' ? 'Seleccionar…' : 'Select…';
  select.append(defaultOpt);

  inp.options.forEach(opt => {
    const option = el('option', { value: opt.value });
    option.textContent = localize(opt.label);
    if (answers[inp.name] === opt.value) option.selected = true;
    select.append(option);
  });

  select.addEventListener('change', () => {
    answers[inp.name] = select.value;
  });

  // Restore previous value
  if (answers[inp.name]) select.value = answers[inp.name];

  field.append(select);
  container.append(field);
}

function buildText(inp, answers, container) {
  const field = el('div', { class: 'disc-field' });
  if (inp.label) {
    const label = el('label', { class: 'disc-field__label', for: `inp-${inp.name}` }, localize(inp.label));
    field.append(label);
  }
  const input = el('input', {
    class: 'disc-input',
    type: 'text',
    id: `inp-${inp.name}`,
    name: inp.name,
    placeholder: inp.placeholder ? localize(inp.placeholder) : '',
    required: inp.required ? true : undefined,
    value: answers[inp.name] ?? ''
  });

  input.addEventListener('input', () => {
    answers[inp.name] = input.value;
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const continueBtn = input.closest('.disc-card, .disc-followup')?.querySelector('.disc-btn--primary');
      continueBtn?.click();
    }
  });

  field.append(input);
  container.append(field);
}

function buildTextarea(inp, answers, container) {
  const field = el('div', { class: 'disc-field' });
  const textarea = el('textarea', {
    class: 'disc-textarea',
    id: `inp-${inp.name}`,
    name: inp.name,
    maxlength: inp.maxLength ?? undefined,
    rows: '4',
    placeholder: inp.placeholder ? localize(inp.placeholder) : ''
  });

  textarea.textContent = answers[inp.name] ?? '';

  textarea.addEventListener('input', () => {
    answers[inp.name] = textarea.value;
  });

  field.append(textarea);
  container.append(field);
}

// Chips that fill a text input when clicked (Q3, Q7)
function buildLinkedChips(inp, answers, container, q) {
  const targetInput = q.inputs.find(i => i.type === 'text' || i.type === 'textarea');
  const chipsWrap = el('div', { class: 'disc-chips', role: 'group', 'aria-label': getLang() === 'es' ? 'Sugerencias' : 'Suggestions' });

  inp.options.forEach(opt => {
    const isActive = answers['_chip_hint'] === opt.value;
    const chip = el('button', {
      class: `disc-chip${isActive ? ' disc-chip--active' : ''}`,
      type: 'button',
      'aria-pressed': isActive ? 'true' : 'false',
      onClick: () => {
        answers['_chip_hint'] = opt.value;
        const label = localize(opt.label);
        // Fill the linked text input
        if (targetInput) {
          answers[targetInput.name] = label;
          const textEl = container.closest('.disc-card__inputs')?.querySelector(`#inp-${targetInput.name}`);
          if (textEl) textEl.value = label;
        }
        // Re-render chips to update active state
        const allChips = chipsWrap.querySelectorAll('.disc-chip');
        allChips.forEach(c => {
          const active = c.textContent.trim() === label;
          c.setAttribute('aria-pressed', active ? 'true' : 'false');
          c.classList.toggle('disc-chip--active', active);
        });
        chipsWrap.dispatchEvent(new CustomEvent('disc:answer-changed', { bubbles: true }));
      }
    }, localize(opt.label));
    chipsWrap.append(chip);
  });

  container.append(chipsWrap);
}

// Chips that are single-select standalone (Q4)
function buildSingleSelectChips(inp, answers, container) {
  const chipsWrap = el('div', { class: 'disc-chips', role: 'radiogroup', 'aria-label': localize(inp.label ?? '') });

  inp.options.forEach(opt => {
    const isActive = answers[inp.name] === opt.value;
    const chip = el('button', {
      class: `disc-chip${isActive ? ' disc-chip--active' : ''}`,
      type: 'button',
      role: 'radio',
      'aria-checked': isActive ? 'true' : 'false',
      onClick: () => {
        answers[inp.name] = opt.value;
        // Update UI without full re-render
        const allChips = chipsWrap.querySelectorAll('.disc-chip');
        allChips.forEach(c => {
          const active = c === chip;
          c.setAttribute('aria-checked', active ? 'true' : 'false');
          c.classList.toggle('disc-chip--active', active);
        });
        chipsWrap.dispatchEvent(new CustomEvent('disc:answer-changed', { bubbles: true }));
      }
    }, localize(opt.label));
    chipsWrap.append(chip);
  });

  // Q4 KPI hint
  if (inp.name === 'hours_range') {
    const kpiWrap = el('div', { class: 'disc-kpi', style: 'margin-top:8px;' });
    const kpiK = el('div', { class: 'disc-kpi__k' }, getLang() === 'es' ? 'HORAS/SEM' : 'HRS/WEEK');
    const kpiV = el('div', { class: 'disc-kpi__v' });
    kpiV.innerHTML = answers[inp.name] ? esc(answers[inp.name]) + '<em>h</em>' : '—';
    kpiWrap.append(kpiK, kpiV);
    container.append(chipsWrap, kpiWrap);
    return;
  }

  container.append(chipsWrap);
}

function buildMultiselect(inp, answers, container) {
  if (!answers[inp.name]) answers[inp.name] = [];
  const selected = answers[inp.name];
  const extraAnswers = answers['_extra'] ?? {};
  answers['_extra'] = extraAnswers;

  const list = el('div', { class: 'disc-multiselect', role: 'group', 'aria-label': localize(inp.label ?? '') });

  inp.options.forEach(opt => {
    const isChecked = selected.includes(opt.value);
    const row = el('div', {
      class: 'disc-multiselect__row',
      role: 'checkbox',
      'aria-checked': isChecked ? 'true' : 'false',
      tabindex: '0'
    });

    const box = el('div', { class: 'disc-multiselect__box', 'aria-hidden': 'true' });
    box.innerHTML = SVG_CHECK;

    const label = el('span', { class: 'disc-multiselect__label' }, localize(opt.label));
    row.append(box, label);

    const toggle = () => {
      const checked = row.getAttribute('aria-checked') === 'true';
      row.setAttribute('aria-checked', checked ? 'false' : 'true');
      if (checked) {
        const idx = selected.indexOf(opt.value);
        if (idx > -1) selected.splice(idx, 1);
        // Hide extra input if present
        const extraWrap = row.nextElementSibling;
        if (extraWrap?.classList.contains('disc-multiselect__extra')) extraWrap.style.display = 'none';
      } else {
        selected.push(opt.value);
        // Show extra input if present
        if (opt.extra) {
          const extraWrap = row.nextElementSibling;
          if (extraWrap?.classList.contains('disc-multiselect__extra')) {
            extraWrap.style.display = '';
            extraWrap.querySelector('input')?.focus();
          }
        }
      }
      row.dispatchEvent(new CustomEvent('disc:answer-changed', { bubbles: true }));
    };

    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
    });

    list.append(row);

    // Extra text input (e.g., ERP name, CRM name)
    if (opt.extra) {
      const extraWrap = el('div', {
        class: 'disc-multiselect__extra',
        style: isChecked ? '' : 'display:none;padding:8px 16px 8px 48px;'
      });
      const extraInput = el('input', {
        class: 'disc-input',
        type: 'text',
        placeholder: opt.extra.placeholder ?? '',
        value: extraAnswers[opt.extra.name] ?? '',
        name: opt.extra.name
      });
      extraInput.addEventListener('input', () => {
        extraAnswers[opt.extra.name] = extraInput.value;
      });
      extraWrap.append(extraInput);
      list.append(extraWrap);
    }
  });

  container.append(list);
}

function buildPhone(inp, answers, container) {
  const field = el('div', { class: 'disc-field' });
  const label = el('label', { class: 'disc-field__label', for: 'inp-phone' },
    getLang() === 'es' ? 'Teléfono' : 'Phone');
  field.append(label);

  const row = el('div', { style: 'display:flex;gap:8px;align-items:flex-end;' });

  const prefix = el('select', { class: 'disc-select', id: 'inp-phone-prefix', style: 'width:100px;flex-shrink:0;' });
  [
    { v: '+51',  l: '+51 PE' },
    { v: '+52',  l: '+52 MX' },
    { v: '+54',  l: '+54 AR' },
    { v: '+55',  l: '+55 BR' },
    { v: '+56',  l: '+56 CL' },
    { v: '+57',  l: '+57 CO' },
    { v: '+58',  l: '+58 VE' },
    { v: '+593', l: '+593 EC' },
    { v: '+1',   l: '+1 US' },
    { v: '+34',  l: '+34 ES' }
  ].forEach(({ v, l }) => {
    const opt = el('option', { value: v });
    opt.textContent = l;
    if ((answers['_phone_prefix'] ?? '+51') === v) opt.selected = true;
    prefix.append(opt);
  });
  prefix.addEventListener('change', () => { answers['_phone_prefix'] = prefix.value; });

  const phoneInput = el('input', {
    class: 'disc-input',
    type: 'tel',
    id: 'inp-phone',
    name: inp.name,
    placeholder: '999 999 999',
    value: answers[inp.name] ?? '',
    style: 'flex:1;'
  });
  phoneInput.addEventListener('input', () => {
    answers[inp.name] = phoneInput.value;
  });

  row.append(prefix, phoneInput);
  field.append(row);
  container.append(field);
}

function buildCheckbox(inp, answers, container) {
  if (answers[inp.name] === undefined) answers[inp.name] = inp.default ?? false;

  const row = el('div', { style: 'display:flex;align-items:center;gap:12px;margin-top:8px;' });

  const cb = el('input', {
    type: 'checkbox',
    id: `inp-${inp.name}`,
    name: inp.name,
    style: 'width:18px;height:18px;cursor:pointer;accent-color:var(--arq);'
  });
  cb.checked = !!answers[inp.name];

  cb.addEventListener('change', () => {
    answers[inp.name] = cb.checked;
  });

  const label = el('label', {
    for: `inp-${inp.name}`,
    class: 'disc-field__label',
    style: 'text-transform:none;letter-spacing:0;font-size:var(--text-small);cursor:pointer;'
  }, localize(inp.label ?? ''));

  row.append(cb, label);
  container.append(row);
}

// ─── CALENDLY EMBED ────────────────────────────────────────────────────────
function buildCalendly(container) {
  // Demo mode: skip the Calendly iframe (URL isn't wired yet) and render a
  // placeholder. Mark booking as satisfied so Continue enables.
  if (state.is_demo) {
    state.calendly_booked = true;
    const wrap = el('div', { class: 'disc-calendly disc-calendly--demo' });
    wrap.style.cssText = 'border:1px dashed rgba(96,165,250,.32); background:rgba(11,18,32,.46); padding:24px; display:flex; flex-direction:column; gap:8px; align-items:flex-start;';
    const eye = el('span', {}, '// DEMO · calendly placeholder');
    eye.style.cssText = 'font-family:var(--font-mono); font-size:10px; letter-spacing:.14em; color:rgba(96,165,250,.7); text-transform:uppercase;';
    const head = el('p', {}, 'Live mode shows a Calendly inline widget here. In demo we skip it so you can finish the flow.');
    head.style.cssText = 'margin:0; font-size:14px; color:rgba(255,255,255,.78);';
    wrap.append(eye, head);
    container.append(wrap);
    return;
  }

  // TODO Rafael: replace this URL with your real Calendly link once published.
  const CALENDLY_URL = 'https://calendly.com/rafaelschwart/discovery?primary_color=2563eb&hide_landing_page_details=1&hide_gdpr_banner=1';

  const wrap = el('div', { class: 'disc-calendly' });
  const widget = el('div', {
    class: 'calendly-inline-widget',
    'data-url': CALENDLY_URL,
    style: 'min-width:320px;height:600px;'
  });
  wrap.append(widget);
  container.append(wrap);

  // Load Calendly script once
  if (!document.querySelector('script[src*="assets.calendly.com"]')) {
    const s = document.createElement('script');
    s.src = 'https://assets.calendly.com/assets/external/widget.js';
    s.async = true;
    document.head.appendChild(s);
  }
}

// Calendly postMessage listener (attached once)
let _calendlyListenerAttached = false;
function attachCalendlyListener() {
  if (_calendlyListenerAttached) return;
  _calendlyListenerAttached = true;
  window.addEventListener('message', e => {
    if (e.data?.event === 'calendly.event_scheduled') {
      state.calendly_booked = true;
      const answers = getAnswerStore('Q10');
      answers['calendly_url'] = e.data.payload?.event?.uri ?? '';
      // Enable the Continue button
      const btn = document.querySelector('.disc-card__actions .disc-btn--primary');
      if (btn) btn.removeAttribute('disabled');
    }
  });
}

// ─── FOLLOW-UP BLOCK ───────────────────────────────────────────────────────
function buildFollowupBlock(fq) {
  const block = el('div', { class: 'disc-followup', role: 'region', 'aria-label': 'Follow-up question' });
  const eyebrow = el('p', { class: 'disc-followup__eyebrow' }, getLang() === 'es' ? 'Una pregunta más' : 'One more thing');
  const prompt = el('p', { class: 'disc-followup__prompt' }, localize(fq.prompt));

  block.append(eyebrow, prompt);

  const answers = getAnswerStore(fq.id);
  const inputsWrap = el('div', { class: 'disc-card__inputs', style: 'margin-top:8px;' });
  buildInputs(fq, inputsWrap);
  block.append(inputsWrap);

  return block;
}

// ─── CARD ACTIONS ──────────────────────────────────────────────────────────
// V2 helper: collect the names of all required inputs on the current question
// (and its sibling follow-up, if any). Empty value in the answer store ⇒ Continue stays disabled.
function requiredInputNames(q) {
  const names = [];
  (q.inputs || []).forEach(inp => {
    if (inp.required) names.push({ name: inp.name, type: inp.type });
  });
  return names;
}

function isAnswerEmpty(value, type) {
  if (value === undefined || value === null) return true;
  if (type === 'multiselect') return !Array.isArray(value) || value.length === 0;
  if (type === 'checkbox')    return value !== true;
  return String(value).trim() === '';
}

// Re-evaluates whether the Continue button on a given card should be enabled.
// Called on every input/change event inside the card.
function refreshContinueState(q, continueBtn) {
  const isCalendlyQ = q.inputs?.some(i => i.type === 'calendly');
  if (isCalendlyQ) {
    if (state.calendly_booked) continueBtn.removeAttribute('disabled');
    else continueBtn.setAttribute('disabled', 'true');
    return;
  }
  const answers = getAnswerStore(q.id);
  const required = requiredInputNames(q);
  const missing = required.some(r => isAnswerEmpty(answers[r.name], r.type));
  if (missing) continueBtn.setAttribute('disabled', 'true');
  else continueBtn.removeAttribute('disabled');
}

function buildCardActions(q) {
  const actions = el('div', { class: 'disc-card__actions' });

  const isFirst = q.id === 'Q1' || (q.is_followup && q.id === 'Q1.1');
  if (!isFirst) {
    const backBtn = el('button', {
      class: 'disc-btn disc-btn--ghost',
      type: 'button',
      onClick: handleBack
    }, t('wizard.back'));
    actions.append(backBtn);
  }

  const isCalendlyQ = q.inputs?.some(i => i.type === 'calendly');
  const continueBtn = el('button', {
    class: 'disc-btn disc-btn--primary',
    type: 'button',
    onClick: () => handleContinue(q)
  }, t('wizard.continue'));

  actions.append(continueBtn);

  // Initial disabled state — calendly waits for booking, other questions wait
  // for required inputs to be filled. Re-evaluates on every input event.
  // setTimeout 0 to let buildInputs finish appending so the card exists in the DOM.
  setTimeout(() => {
    refreshContinueState(q, continueBtn);
    const card = continueBtn.closest('.disc-card');
    if (card) {
      const handler = () => refreshContinueState(q, continueBtn);
      card.addEventListener('input', handler);
      card.addEventListener('change', handler);
      // Custom event fired by chip/multiselect handlers (when value lives outside DOM).
      card.addEventListener('disc:answer-changed', handler);
    }
  }, 0);

  // Attach Calendly listener when on Q10
  if (isCalendlyQ) attachCalendlyListener();

  return actions;
}

// ─── EMAIL GATE ────────────────────────────────────────────────────────────
function renderGate(root) {
  const overlay = el('div', {
    class: 'disc-gate',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'gate-heading'
  });

  // Block escape and overlay click — gate cannot be dismissed
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') e.preventDefault();
  });

  const panel = el('div', { class: 'disc-gate__panel' });

  const eyebrow = el('p', { class: 'disc-gate__eyebrow' }, t('gate.eyebrow'));
  const heading = el('h2', { class: 'disc-gate__heading', id: 'gate-heading' }, t('gate.title'));
  const sub = el('p', { class: 'disc-gate__sub' }, t('gate.subtitle'));

  // Error msg placeholder
  const errorMsg = el('p', { class: 'disc-field__error', style: 'display:none;', role: 'alert' });

  const form = el('form', { class: 'disc-gate__form', novalidate: true });

  const nameField = el('div', { class: 'disc-field' });
  const nameLbl = el('label', { class: 'disc-field__label', for: 'gate-name' }, t('gate.name'));
  const nameInput = el('input', {
    class: 'disc-input',
    type: 'text',
    id: 'gate-name',
    name: 'name',
    autocomplete: 'given-name',
    required: true
  });
  if (state.is_demo) nameInput.value = 'Mariana Reyes';
  nameField.append(nameLbl, nameInput);

  const emailField = el('div', { class: 'disc-field' });
  const emailLbl = el('label', { class: 'disc-field__label', for: 'gate-email' }, t('gate.email'));
  const emailInput = el('input', {
    class: 'disc-input',
    type: 'email',
    id: 'gate-email',
    name: 'email',
    autocomplete: 'email',
    inputmode: 'email',
    required: true
  });
  if (state.is_demo) emailInput.value = 'mariana@distribuidoraandina.com';
  emailField.append(emailLbl, emailInput);

  const companyField = el('div', { class: 'disc-field' });
  const companyLbl = el('label', { class: 'disc-field__label', for: 'gate-company' }, t('gate.company'));
  const companyInput = el('input', {
    class: 'disc-input',
    type: 'text',
    id: 'gate-company',
    name: 'company',
    autocomplete: 'organization'
  });
  if (state.is_demo) companyInput.value = 'Distribuidora Andina';
  companyField.append(companyLbl, companyInput);

  // Honeypot — visually hidden, screen-reader hidden
  const honeypot = el('div', { style: 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;', 'aria-hidden': 'true', tabindex: '-1' });
  const honeypotInput = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
  honeypot.append(honeypotInput);

  const submitBtn = el('button', {
    class: 'disc-btn disc-btn--arq disc-gate__cta',
    type: 'submit'
  }, t('gate.submit'));

  const privacy = el('p', { class: 'disc-gate__privacy' }, t('gate.privacy'));

  form.append(nameField, emailField, companyField, honeypot, submitBtn);
  panel.append(eyebrow, heading, sub, errorMsg, form, privacy);
  overlay.append(panel);
  root.append(overlay);

  // Focus first input after render
  requestAnimationFrame(() => nameInput.focus());

  // Form submit
  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorMsg.style.display = 'none';

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const company = companyInput.value.trim();
    const honeypotVal = honeypotInput.value;

    // Client-side email validation
    if (!name) { showGateError(errorMsg, emailInput, getLang() === 'es' ? 'Ingresa tu nombre.' : 'Please enter your name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showGateError(errorMsg, emailInput, getLang() === 'es' ? 'Email inválido.' : 'Invalid email address.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = getLang() === 'es' ? 'Guardando…' : 'Saving…';

    try {
      if (state.is_demo) {
        // Demo: skip the API call, auto-advance
        await new Promise(r => setTimeout(r, 600));
        state.phase = 'wizard';
        advanceToNextQuestion({ action: 'next', question: DEMO_QUESTIONS[4] }); // Q5
        return;
      }

      const resp = await api('/gate', {
        method: 'POST',
        body: { name, email, company: company || undefined, honeypot: honeypotVal }
      });

      if (resp.action === 'check_email') {
        // Existing user — magic link sent
        showGateError(errorMsg, emailInput,
          getLang() === 'es'
            ? 'Ya existe una cuenta con ese email. Te enviamos un magic link.'
            : 'That email already has a profile. Check your inbox for a magic link.');
        submitBtn.disabled = false;
        submitBtn.textContent = t('gate.submit');
        return;
      }

      state.phase = 'wizard';
      advanceToNextQuestion(resp);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = t('gate.submit');
      showGateError(errorMsg, emailInput,
        getLang() === 'es' ? 'Algo salió mal. Intenta de nuevo.' : 'Something went wrong. Please try again.');
    }
  });
}

function showGateError(errorEl, inputEl, msg) {
  errorEl.textContent = msg;
  errorEl.style.display = '';
  inputEl.classList.add('disc-input--error');
  inputEl.focus();
}

// ─── BUILDING / LOADING SCREEN ─────────────────────────────────────────────
function renderBuilding(root) {
  const screen = el('div', { class: 'disc-loading', role: 'status', 'aria-live': 'polite', 'aria-label': t('building.title') });
  const inner = el('div', { class: 'disc-loading__inner' });

  const eyebrow = el('p', { class: 'disc-loading__eyebrow' }, '// V01 · DISCOVERY');
  const heading = el('h1', { class: 'disc-loading__heading' });
  heading.innerHTML = t('building.title').replace('profile', '<em>profile</em>').replace('perfil', '<em>perfil</em>');
  const sub = el('p', { class: 'disc-loading__sub' }, t('building.sub'));

  const dots = el('div', { class: 'disc-loading__dots', 'aria-hidden': 'true' });
  for (let i = 0; i < 4; i++) dots.append(el('span', {}));

  inner.append(eyebrow, heading, sub, dots);
  screen.append(inner);
  root.append(screen);
}

// ─── DEMO BADGE ────────────────────────────────────────────────────────────
function renderDemoBadge() {
  let badge = document.getElementById('disc-demo-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'disc-demo-badge';
    badge.style.cssText = 'position:fixed;bottom:12px;right:12px;font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.14em;padding:4px 10px;background:#0B1220;color:#F8FAFC;text-transform:uppercase;z-index:9999;pointer-events:none;';
    badge.textContent = '// DEMO MODE';
    document.body.append(badge);
  }
}

// ─── FLOW HANDLERS ─────────────────────────────────────────────────────────
async function handleStart() {
  const btn = document.querySelector('.disc-landing__start');
  if (btn) { btn.disabled = true; btn.textContent = getLang() === 'es' ? 'Iniciando…' : 'Starting…'; }

  try {
    if (state.is_demo) {
      // Demo: use local questions, skip API
      await new Promise(r => setTimeout(r, 400));
      state.phase = 'wizard';
      state.current_question = DEMO_QUESTIONS[0];
      state.followup_question = null;
      render();
      return;
    }

    const resp = await api('/start', {
      method: 'POST',
      body: { language: getLang(), ...state.utm }
    });

    state.prospect_id = resp.prospect_id;
    state.phase = 'wizard';
    state.current_question = resp.first_question;
    state.followup_question = null;
    render();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = t('wizard.start') + ' →'; }
    console.error('[Arq] /start failed:', err);
  }
}

async function handleContinue(q) {
  if (state.loading) return;

  // Collect the answer
  const answers = getAnswerStore(q.id);
  const isMultiInput = q.inputs.length > 1 || q.inputs[0]?.type === 'multiselect';

  let value_text = null;
  let value_json = null;

  if (q.inputs.length === 1 && !isMultiInput) {
    const inp = q.inputs[0];
    if (inp.type === 'text' || inp.type === 'textarea') value_text = answers[inp.name] ?? null;
    else if (inp.type === 'chips') value_text = answers[inp.name] ?? null;
    else if (inp.type === 'select') value_text = answers[inp.name] ?? null;
    else value_json = answers;
  } else {
    value_json = buildValueJson(q, answers);
  }

  // Handle follow-up submission first
  if (q.is_followup && state.followup_question) {
    const fq = state.followup_question;
    const fAnswers = getAnswerStore(fq.id);
    const fText = fAnswers[fq.inputs[0]?.name ?? ''] ?? '';

    if (!state.is_demo) {
      try {
        state.loading = true;
        await api('/answer', {
          method: 'POST',
          body: {
            question_id: fq.id,
            value_text: fText || null,
            is_followup: true
          }
        });
      } catch (_) { /* non-blocking */ }
      state.loading = false;
    }
    state.followup_question = null;
    state.followup_answered = true;
    // Now send the main question answer
    await submitAnswer(state.current_question, value_text, value_json);
    return;
  }

  // If there's a pending follow-up, submit it before continuing
  if (state.followup_question) {
    const fq = state.followup_question;
    const fAnswers = getAnswerStore(fq.id);
    const fText = fAnswers[fq.inputs[0]?.name ?? ''] ?? '';
    if (!state.is_demo) {
      try {
        await api('/answer', {
          method: 'POST',
          body: { question_id: fq.id, value_text: fText || null, is_followup: true }
        });
      } catch (_) { /* non-blocking */ }
    }
    state.followup_question = null;
    state.followup_answered = true;  // flag so handleDemoAnswer doesn't re-fire it
  }

  await submitAnswer(q, value_text, value_json);
}

function buildValueJson(q, answers) {
  const out = {};
  q.inputs.forEach(inp => {
    if (inp.type === 'chips') {
      out['chip_hint'] = answers['_chip_hint'] ?? null;
    } else if (inp.type === 'multiselect') {
      out[inp.name] = answers[inp.name] ?? [];
      if (answers['_extra']) Object.assign(out, answers['_extra']);
    } else if (inp.type === 'phone') {
      const prefix = answers['_phone_prefix'] ?? '+51';
      out['phone'] = (answers[inp.name] ? prefix + ' ' + answers[inp.name] : null);
    } else if (inp.type === 'checkbox') {
      out[inp.name] = answers[inp.name] ?? false;
    } else if (inp.type === 'calendly') {
      out['calendly_url'] = answers['calendly_url'] ?? null;
    } else {
      out[inp.name] = answers[inp.name] ?? null;
    }
  });
  return out;
}

async function submitAnswer(q, value_text, value_json) {
  // Optimistically mark this anchor as answered
  if (!q.is_followup && !state.answered_ids.includes(q.id)) {
    state.answered_ids.push(q.id);
  }

  if (state.is_demo) {
    handleDemoAnswer(q);
    return;
  }

  state.loading = true;
  const continueBtn = document.querySelector('.disc-card__actions .disc-btn--primary');
  if (continueBtn) { continueBtn.disabled = true; continueBtn.textContent = getLang() === 'es' ? 'Enviando…' : 'Sending…'; }

  try {
    const resp = await api('/answer', {
      method: 'POST',
      body: {
        question_id: q.id,
        value_text: value_text || null,
        value_json: value_json || null
      }
    });
    state.loading = false;
    advanceToNextQuestion(resp);
  } catch (err) {
    state.loading = false;
    console.error('[Arq] /answer failed:', err);
    if (continueBtn) { continueBtn.disabled = false; continueBtn.textContent = t('wizard.continue'); }
  }
}

function advanceToNextQuestion(resp) {
  if (resp.action === 'next') {
    state.current_question = resp.question;
    state.followup_question = null;
    render();
  } else if (resp.action === 'followup') {
    state.followup_question = resp.question;
    render();
  } else if (resp.action === 'gate') {
    state.phase = 'gate';
    render();
  } else if (resp.action === 'complete') {
    handleComplete();
  }
}

function handleBack() {
  // If a follow-up is showing, dismiss it
  if (state.followup_question) {
    state.followup_question = null;
    render();
    return;
  }

  const anchorIds = ['Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9','Q10'];
  const baseId = state.current_question?.id?.split('.')[0] ?? 'Q1';
  const idx = anchorIds.indexOf(baseId);
  if (idx <= 0) return;

  const prevId = anchorIds[idx - 1];
  const prevQ = DEMO_QUESTIONS.find(q => q.id === prevId);

  // Remove the current from answered
  const ansIdx = state.answered_ids.indexOf(baseId);
  if (ansIdx > -1) state.answered_ids.splice(ansIdx, 1);

  if (prevQ) {
    state.current_question = prevQ;
    state.followup_question = null;
    render();
  }
}

// ─── DEMO ANSWER FLOW ──────────────────────────────────────────────────────
function handleDemoAnswer(q) {
  const anchorIds = ['Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9','Q10'];
  const baseId = q.is_followup ? q.id.split('.')[0] : q.id;
  const idx = anchorIds.indexOf(baseId);

  // After Q4 → gate
  if (baseId === 'Q4') {
    state.phase = 'gate';
    render();
    return;
  }

  // After Q10 → complete
  if (baseId === 'Q10') {
    handleComplete();
    return;
  }

  // Check if this question has a demo follow-up and it hasn't fired yet.
  // Skip if the user just answered a follow-up (handleContinue sets followup_answered).
  const hasFollowup = DEMO_FOLLOWUPS[baseId];
  if (hasFollowup && !state.followup_question && !q.is_followup && !state.followup_answered) {
    state.followup_question = { ...hasFollowup, is_followup: true };
    render();
    return;
  }

  // Advance to next question — clear the follow-up flag for the next anchor
  state.followup_question = null;
  state.followup_answered = false;
  const nextId = anchorIds[idx + 1];
  if (nextId) {
    state.current_question = DEMO_QUESTIONS.find(q => q.id === nextId);
    render();
  }
}

async function handleComplete() {
  const startTime = Date.now();
  state.phase = 'building';
  render();

  if (state.is_demo) {
    const elapsed = Date.now() - startTime;
    const wait = Math.max(0, 1800 - elapsed);
    await new Promise(r => setTimeout(r, wait));
    window.location.href = '/discovery/p/demo?demo=1';
    return;
  }

  try {
    const resp = await api('/complete', { method: 'POST', body: {} });
    const elapsed = Date.now() - startTime;
    const wait = Math.max(0, 1500 - elapsed);
    await new Promise(r => setTimeout(r, wait));
    window.location.href = resp.dashboard_url;
  } catch (err) {
    console.error('[Arq] /complete failed:', err);
    // Still redirect to avoid trapping the user
    await new Promise(r => setTimeout(r, 1500));
    window.location.href = '/discovery/p/error';
  }
}

// ─── LANGUAGE CHANGE LISTENER ──────────────────────────────────────────────
document.addEventListener('arq:lang', () => {
  state.language = getLang();
  render();
});

// ─── BOOT ──────────────────────────────────────────────────────────────────
setLang(getLang());
render();
