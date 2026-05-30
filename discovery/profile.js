// discovery/profile.js
// ─── IMPORTS ────────────────────────────────────────────────────────────────
import { getLang, setLang, t } from './i18n.js';
import { api } from './api.js';
import { animate, stagger } from './vendor/anime.esm.js';

// ─── REDUCED MOTION ──────────────────────────────────────────────────────────
const RM = window.matchMedia('(prefers-reduced-motion: reduce)');

// Guard: entrance animations only run on the very first mount.
// Editing a section triggers a re-mount; we skip the entrance then.
let _hasAnimatedIn = false;

// ─── DEMO DATA ───────────────────────────────────────────────────────────────
const DEMO_PROFILE = {
  prospect: {
    id: 'demo-uuid',
    name: 'Mariana Reyes',
    email: 'mariana@distribuidoraandina.com',
    company: 'Distribuidora Andina',
    role: 'coo',
    phone: '+51 999 999 999',
    country: 'Peru',
    language: 'en',
    sector_id: 'distribucion',
    magic_token: 'demo',
    status: 'booked',
    calendly_url: 'https://calendly.com/rafaelschwart/discovery/2026-05-28T15:00:00Z'
  },
  answers: [
    { question_id: 'Q1', value_json: { industry: 'distribucion', headcount: '51-200' }},
    { question_id: 'Q2', value_text: 'We distribute consumer goods to 380 bodegas in Lima from a single warehouse — daily routes, weekly invoicing.' },
    { question_id: 'Q3', value_text: 'Reconciling sales across 4 spreadsheets', value_json: { chips: ['reconciling'] }},
    { question_id: 'Q3.1', value_text: 'Two staff and me'},
    { question_id: 'Q4', value_json: { hours_range: '10-20' }},
    { question_id: 'Q5', value_json: { tools: ['excel', 'erp', 'whatsapp'], erp_name: 'SAP Business One' }},
    { question_id: 'Q6', value_json: { data_state: 'systems_disconnected' }},
    { question_id: 'Q6.1', value_text: 'Our ERP and our shipping system'},
    { question_id: 'Q7', value_text: 'Real-time KPIs', value_json: { chips: ['kpis'] }},
    { question_id: 'Q7.1', value_text: 'Weekly close time from 3 days to 4 hours'},
    { question_id: 'Q8', value_json: { metric: 'weekly close time', target: '3 days → 4 hours' }},
    { question_id: 'Q9', value_json: { role: 'coo', decision_unit: 'finance' }},
    { question_id: 'Q10', value_json: { phone: '+51 999 999 999', whatsapp_ok: true }}
  ],
  summary: {
    prospect_id: 'demo-uuid',
    summary_text: "Mariana runs ops at a mid-size distribución company in Lima. Her biggest weekly bottleneck is <em>sales reconciliation</em> across 4 spreadsheets — eating 18 hours/week between her and 2 staff. She wants a real-time KPI dashboard that closes weekly numbers in 4 hours instead of 3 days. Decision: her plus the CFO.",
    sector_classification: 'distribucion',
    est_hours_saved: 16,
    est_payback_months: 3,
    suggested_capability: 'C.01+C.04',
    generated_at: '2026-05-23T03:00:00Z',
    generated_by: 'claude-haiku-4-5-20251001'
  }
};

// ─── SECTION DEFINITIONS ─────────────────────────────────────────────────────
// Maps each profile section to which question IDs it covers and how to
// generate the condensed 1-line summary shown in collapsed state.
const SECTIONS = [
  {
    id: 'business',
    labelKey: 'profile.section.business',
    num: '01',
    questionIds: ['Q1', 'Q2'],
    summarize(answers) {
      const q1 = answers.find(a => a.question_id === 'Q1');
      const q2 = answers.find(a => a.question_id === 'Q2');
      const parts = [];
      if (q1?.value_json?.industry) parts.push(q1.value_json.industry);
      if (q1?.value_json?.headcount) parts.push(q1.value_json.headcount + ' staff');
      if (q2?.value_text) parts.push(q2.value_text.slice(0, 60) + (q2.value_text.length > 60 ? '…' : ''));
      return parts.join(' · ') || '—';
    },
    renderInputs(answers) {
      const q1 = answers.find(a => a.question_id === 'Q1') || {};
      const q2 = answers.find(a => a.question_id === 'Q2') || {};
      const json1 = q1.value_json || {};
      return `
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q1-industry">Industry</label>
          <select class="disc-select" id="edit-q1-industry" name="Q1.industry">
            ${['distribucion','retail','manufactura','servicios','logistica','salud','construccion','educacion','other'].map(v =>
              `<option value="${esc(v)}"${json1.industry === v ? ' selected' : ''}>${esc(lookupLabel('industry', v))}</option>`
            ).join('')}
          </select>
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q1-headcount">Headcount</label>
          <select class="disc-select" id="edit-q1-headcount" name="Q1.headcount">
            ${['solo','1-10','11-50','51-200','200+'].map(v =>
              `<option value="${esc(v)}"${json1.headcount === v ? ' selected' : ''}>${esc(lookupLabel('headcount', v))}</option>`
            ).join('')}
          </select>
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q2">What your company does</label>
          <textarea class="disc-textarea" id="edit-q2" name="Q2.description" maxlength="280" rows="3">${esc(q2.value_text || '')}</textarea>
        </div>
      `;
    },
    collectAnswers(form) {
      const industry = form.querySelector('[name="Q1.industry"]')?.value || '';
      const headcount = form.querySelector('[name="Q1.headcount"]')?.value || '';
      const description = form.querySelector('[name="Q2.description"]')?.value || '';
      return [
        { question_id: 'Q1', value_json: { industry, headcount } },
        { question_id: 'Q2', value_text: description }
      ];
    }
  },
  {
    id: 'operations',
    labelKey: 'profile.section.operations',
    num: '02',
    questionIds: ['Q3', 'Q3.1', 'Q4'],
    summarize(answers) {
      const q3 = answers.find(a => a.question_id === 'Q3');
      const q4 = answers.find(a => a.question_id === 'Q4');
      const parts = [];
      if (q3?.value_text) parts.push(q3.value_text.slice(0, 50) + (q3.value_text.length > 50 ? '…' : ''));
      if (q4?.value_json?.hours_range) parts.push(q4.value_json.hours_range + 'h/wk');
      return parts.join(' · ') || '—';
    },
    renderInputs(answers) {
      const q3 = answers.find(a => a.question_id === 'Q3') || {};
      const q31 = answers.find(a => a.question_id === 'Q3.1') || {};
      const q4 = answers.find(a => a.question_id === 'Q4') || {};
      const json4 = q4.value_json || {};
      const hoursOptions = ['1-5','5-10','10-20','20-40','40+'];
      return `
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q3">Most painful manual process</label>
          <input class="disc-input" id="edit-q3" name="Q3.process" type="text" value="${esc(q3.value_text || '')}" />
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q31">Who runs it today?</label>
          <input class="disc-input" id="edit-q31" name="Q3.1.owner" type="text" value="${esc(q31.value_text || '')}" />
        </div>
        <div class="disc-field">
          <span class="disc-field__label">Hours per week (combined)</span>
          <div class="disc-chips" role="group" aria-label="Hours per week">
            ${hoursOptions.map(v =>
              `<button type="button" class="disc-chip${json4.hours_range === v ? ' disc-chip--active' : ''}" aria-pressed="${json4.hours_range === v}" data-hours="${esc(v)}">${esc(v)}h</button>`
            ).join('')}
          </div>
          <input type="hidden" name="Q4.hours_range" value="${esc(json4.hours_range || '')}" />
        </div>
      `;
    },
    collectAnswers(form) {
      const process = form.querySelector('[name="Q3.process"]')?.value || '';
      const owner = form.querySelector('[name="Q3.1.owner"]')?.value || '';
      const hours = form.querySelector('[name="Q4.hours_range"]')?.value || '';
      return [
        { question_id: 'Q3', value_text: process },
        { question_id: 'Q3.1', value_text: owner },
        { question_id: 'Q4', value_json: { hours_range: hours } }
      ];
    }
  },
  {
    id: 'tools',
    labelKey: 'profile.section.tools',
    num: '03',
    questionIds: ['Q5', 'Q6', 'Q6.1'],
    summarize(answers) {
      const q5 = answers.find(a => a.question_id === 'Q5');
      const q6 = answers.find(a => a.question_id === 'Q6');
      const parts = [];
      if (q5?.value_json?.tools?.length) parts.push(q5.value_json.tools.join(', '));
      if (q6?.value_json?.data_state) parts.push(q6.value_json.data_state.replace(/_/g, ' '));
      return parts.join(' · ') || '—';
    },
    renderInputs(answers) {
      const q5 = answers.find(a => a.question_id === 'Q5') || {};
      const q6 = answers.find(a => a.question_id === 'Q6') || {};
      const q61 = answers.find(a => a.question_id === 'Q6.1') || {};
      const json5 = q5.value_json || {};
      const json6 = q6.value_json || {};
      const toolsList = ['excel','erp','crm','whatsapp','email','paper','custom','head','other'];
      const dataStates = ['spreadsheets_many','systems_disconnected','one_inconsistent','paper_whatsapp','custom_db','mix'];
      return `
        <div class="disc-field">
          <span class="disc-field__label">Tools used</span>
          <div class="disc-chips" role="group" aria-label="Tools">
            ${toolsList.map(v =>
              `<button type="button" class="disc-chip${(json5.tools||[]).includes(v) ? ' disc-chip--active' : ''}" aria-pressed="${(json5.tools||[]).includes(v)}" data-tool="${esc(v)}">${esc(v)}</button>`
            ).join('')}
          </div>
          <input type="hidden" name="Q5.tools" value="${esc((json5.tools||[]).join(','))}" />
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q5-erpname">ERP name (if applicable)</label>
          <input class="disc-input" id="edit-q5-erpname" name="Q5.erp_name" type="text" value="${esc(json5.erp_name || '')}" />
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q6">Where data lives</label>
          <select class="disc-select" id="edit-q6" name="Q6.data_state">
            ${dataStates.map(v =>
              `<option value="${esc(v)}"${json6.data_state === v ? ' selected' : ''}>${esc(lookupLabel('data_state', v))}</option>`
            ).join('')}
          </select>
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q61">Which systems don't talk?</label>
          <input class="disc-input" id="edit-q61" name="Q6.1.systems" type="text" value="${esc(q61.value_text || '')}" />
        </div>
      `;
    },
    collectAnswers(form) {
      const toolsVal = form.querySelector('[name="Q5.tools"]')?.value || '';
      const tools = toolsVal ? toolsVal.split(',').filter(Boolean) : [];
      const erpName = form.querySelector('[name="Q5.erp_name"]')?.value || '';
      const dataState = form.querySelector('[name="Q6.data_state"]')?.value || '';
      const systems = form.querySelector('[name="Q6.1.systems"]')?.value || '';
      return [
        { question_id: 'Q5', value_json: { tools, erp_name: erpName } },
        { question_id: 'Q6', value_json: { data_state: dataState } },
        { question_id: 'Q6.1', value_text: systems }
      ];
    }
  },
  {
    id: 'goals',
    labelKey: 'profile.section.goals',
    num: '04',
    questionIds: ['Q7', 'Q7.1', 'Q8'],
    summarize(answers) {
      const q7 = answers.find(a => a.question_id === 'Q7');
      const q8 = answers.find(a => a.question_id === 'Q8');
      const parts = [];
      if (q7?.value_text) parts.push(q7.value_text.slice(0, 50) + (q7.value_text.length > 50 ? '…' : ''));
      if (q8?.value_json?.target) parts.push(q8.value_json.target);
      return parts.join(' · ') || '—';
    },
    renderInputs(answers) {
      const q7 = answers.find(a => a.question_id === 'Q7') || {};
      const q71 = answers.find(a => a.question_id === 'Q7.1') || {};
      const q8 = answers.find(a => a.question_id === 'Q8') || {};
      const json8 = q8.value_json || {};
      return `
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q7">Fix one thing in 90 days</label>
          <input class="disc-input" id="edit-q7" name="Q7.fix" type="text" value="${esc(q7.value_text || '')}" />
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q71">What number would that move?</label>
          <input class="disc-input" id="edit-q71" name="Q7.1.impact" type="text" value="${esc(q71.value_text || '')}" />
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q8-metric">Success metric</label>
          <input class="disc-input" id="edit-q8-metric" name="Q8.metric" type="text" placeholder="e.g., weekly close time" value="${esc(json8.metric || '')}" />
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q8-target">Target</label>
          <input class="disc-input" id="edit-q8-target" name="Q8.target" type="text" placeholder="e.g., 3 days → 4 hours" value="${esc(json8.target || '')}" />
        </div>
      `;
    },
    collectAnswers(form) {
      const fix = form.querySelector('[name="Q7.fix"]')?.value || '';
      const impact = form.querySelector('[name="Q7.1.impact"]')?.value || '';
      const metric = form.querySelector('[name="Q8.metric"]')?.value || '';
      const target = form.querySelector('[name="Q8.target"]')?.value || '';
      return [
        { question_id: 'Q7', value_text: fix },
        { question_id: 'Q7.1', value_text: impact },
        { question_id: 'Q8', value_json: { metric, target } }
      ];
    }
  },
  {
    id: 'you',
    labelKey: 'profile.section.you',
    num: '05',
    questionIds: ['Q9', 'Q10'],
    summarize(answers) {
      const q9 = answers.find(a => a.question_id === 'Q9');
      const q10 = answers.find(a => a.question_id === 'Q10');
      const parts = [];
      if (q9?.value_json?.role) parts.push(q9.value_json.role.toUpperCase());
      if (q9?.value_json?.decision_unit) parts.push('decision: ' + q9.value_json.decision_unit);
      if (q10?.value_json?.phone) parts.push(q10.value_json.phone);
      return parts.join(' · ') || '—';
    },
    renderInputs(answers) {
      const q9 = answers.find(a => a.question_id === 'Q9') || {};
      const q10 = answers.find(a => a.question_id === 'Q10') || {};
      const json9 = q9.value_json || {};
      const json10 = q10.value_json || {};
      const roles = ['ceo','coo','ops','finance','other'];
      const duUnits = ['me','cofounder','ops_team','finance','exec'];
      return `
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q9-role">Your role</label>
          <select class="disc-select" id="edit-q9-role" name="Q9.role">
            ${roles.map(v =>
              `<option value="${esc(v)}"${json9.role === v ? ' selected' : ''}>${esc(lookupLabel('role', v))}</option>`
            ).join('')}
          </select>
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q9-du">Decision unit</label>
          <select class="disc-select" id="edit-q9-du" name="Q9.decision_unit">
            ${duUnits.map(v =>
              `<option value="${esc(v)}"${json9.decision_unit === v ? ' selected' : ''}>${esc(lookupLabel('decision_unit', v))}</option>`
            ).join('')}
          </select>
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="edit-q10-phone">Phone</label>
          <input class="disc-input" id="edit-q10-phone" name="Q10.phone" type="tel" value="${esc(json10.phone || '')}" />
        </div>
        <div class="disc-field">
          <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" name="Q10.whatsapp_ok" ${json10.whatsapp_ok ? 'checked' : ''} style="width:16px;height:16px;" />
            <span class="disc-field__label" style="margin:0;">OK to follow up via WhatsApp</span>
          </label>
        </div>
      `;
    },
    collectAnswers(form) {
      const role = form.querySelector('[name="Q9.role"]')?.value || '';
      const du = form.querySelector('[name="Q9.decision_unit"]')?.value || '';
      const phone = form.querySelector('[name="Q10.phone"]')?.value || '';
      const whatsapp = form.querySelector('[name="Q10.whatsapp_ok"]')?.checked || false;
      return [
        { question_id: 'Q9', value_json: { role, decision_unit: du } },
        { question_id: 'Q10', value_json: { phone, whatsapp_ok: whatsapp } }
      ];
    }
  }
];

// ─── STATE ───────────────────────────────────────────────────────────────────
const state = {
  profile: null,        // { prospect, answers, summary }
  activeTab: 'profile', // 'profile' | 'next'
  isDemo: false,
  loading: true,
  error: null,          // null | { type: 'not_found' | 'network' }
  passwordSet: false,
  expandedSection: null, // section id currently editing
  editingIdentity: false, // header identity (name/email/phone) edit mode
  reviewGateDismissed: false // user clicked "Take me to my answers" — collapse the big gate, show sticky confirm bar
};

// ─── ESCAPE HELPER ───────────────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── SANITIZE SUMMARY TEXT ───────────────────────────────────────────────────
// Allows only <em> and <strong> tags; strips everything else.
function sanitizeSummary(html) {
  if (!html) return '';
  // Strip any tag that is NOT <em>, </em>, <strong>, </strong>
  return html.replace(/<\/?(?!(?:em|strong)\b)[a-zA-Z][^>]*>/gi, '');
}

// ─── LOCALIZED SELECT LABELS ─────────────────────────────────────────────────
// Profile edit selects were rendering raw enum codes (e.g. "distribucion") instead
// of human labels. lookupLabel() maps codes → EN/ES labels per the current language.
const LABELS = {
  industry: {
    distribucion:  { en: 'Distribution',  es: 'Distribución' },
    retail:        { en: 'Retail',        es: 'Retail' },
    manufactura:   { en: 'Manufacturing', es: 'Manufactura' },
    servicios:     { en: 'Services',      es: 'Servicios' },
    logistica:     { en: 'Logistics',     es: 'Logística' },
    salud:         { en: 'Healthcare',    es: 'Salud' },
    construccion:  { en: 'Construction',  es: 'Construcción' },
    educacion:     { en: 'Education',     es: 'Educación' },
    other:         { en: 'Other',         es: 'Otro' }
  },
  headcount: {
    'solo':   { en: 'Just me',  es: 'Solo yo' },
    '1-10':   { en: '1–10',     es: '1–10' },
    '11-50':  { en: '11–50',    es: '11–50' },
    '51-200': { en: '51–200',   es: '51–200' },
    '200+':   { en: '200+',     es: '200+' }
  },
  data_state: {
    spreadsheets_many:    { en: 'Many spreadsheets',         es: 'Muchas hojas de cálculo' },
    systems_disconnected: { en: 'Disconnected systems',      es: 'Sistemas desconectados' },
    one_inconsistent:     { en: 'One system, inconsistent',  es: 'Un sistema, inconsistente' },
    paper_whatsapp:       { en: 'Paper / WhatsApp',          es: 'Papel / WhatsApp' },
    custom_db:            { en: 'Custom database',           es: 'Base de datos custom' },
    mix:                  { en: 'A mix',                     es: 'Una mezcla' }
  },
  role: {
    ceo:     { en: 'CEO',     es: 'CEO' },
    coo:     { en: 'COO',     es: 'COO' },
    ops:     { en: 'Ops',     es: 'Operaciones' },
    finance: { en: 'Finance', es: 'Finanzas' },
    other:   { en: 'Other',   es: 'Otro' }
  },
  decision_unit: {
    me:         { en: 'Just me',        es: 'Solo yo' },
    cofounder:  { en: 'Co-founder',     es: 'Cofundador' },
    ops_team:   { en: 'Ops team',       es: 'Equipo de ops' },
    finance:    { en: 'Finance team',   es: 'Equipo financiero' },
    exec:       { en: 'Exec committee', es: 'Comité ejecutivo' }
  }
};
function lookupLabel(field, code) {
  const lang = getLang();
  return LABELS[field]?.[code]?.[lang] || code;
}

// ─── AVATAR INITIALS ─────────────────────────────────────────────────────────
function initials(prospect) {
  if (prospect.name) {
    const parts = prospect.name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (prospect.email) return prospect.email.slice(0, 2).toUpperCase();
  if (prospect.company) return prospect.company.slice(0, 2).toUpperCase();
  return '··';
}

// ─── PARSE CALENDLY URL FOR DATE/TIME ────────────────────────────────────────
function parseCalendlyDate(url) {
  if (!url) return null;
  // The URL ends in /2026-05-28T15:00:00Z — extract the ISO fragment
  const match = url.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?)$/);
  if (!match) return null;
  try { return new Date(match[1]); } catch { return null; }
}

function formatCallTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString(getLang() === 'es' ? 'es' : 'en-US', {
    hour: '2-digit', minute: '2-digit', hour12: getLang() !== 'es'
  });
}

function formatCallDate(date) {
  if (!date) return '';
  return date.toLocaleDateString(getLang() === 'es' ? 'es' : 'en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
// Compact snackbar at the bottom-left. Replaces the legacy `.disc-confirm`
// implementation which was inheriting global rules that ballooned it into a
// full-height white panel in the middle of the layout (see the screenshot bug
// report from 2026-05-27).
function showToast(msg, kind = 'info') {
  const existing = document.getElementById('arq-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'arq-toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  // Inline cssText (NOT using the .disc-confirm class to avoid conflicts)
  el.style.cssText = `
    position: fixed !important;
    bottom: 24px;
    left: 24px;
    top: auto;
    transform: none;
    z-index: 9999;
    background: ${kind === 'error' ? 'rgba(252,165,165,.15)' : 'rgba(11,18,32,.92)'};
    border: 1px solid ${kind === 'error' ? '#fca5a5' : 'rgba(96,165,250,.4)'};
    border-left: 3px solid ${kind === 'error' ? '#fca5a5' : 'var(--signal-pale, #60a5fa)'};
    color: ${kind === 'error' ? '#fca5a5' : '#fff'};
    padding: 10px 14px;
    width: auto;
    max-width: 320px;
    height: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: .08em;
    text-transform: uppercase;
    box-shadow: 0 10px 28px -10px rgba(0,0,0,.5);
    opacity: 0;
    transition: opacity .2s ease;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, 2000);
}

// ─── DEMO BADGE ──────────────────────────────────────────────────────────────
function renderDemoBadge() {
  return `<div style="
    position:fixed;bottom:24px;right:24px;z-index:9000;
    background:var(--ink);color:var(--signal-pale);
    font-family:var(--font-mono);font-size:var(--text-mono);
    letter-spacing:var(--tr-mono);text-transform:uppercase;
    padding:8px 12px;border:1px solid var(--signal-pale-24);
    pointer-events:none;
  ">// DEMO MODE</div>`;
}

// ─── COMPLETENESS COUNT ───────────────────────────────────────────────────────
function completenessCount(answers) {
  // A section is "done" if it has at least one answer with content
  const done = SECTIONS.filter(sec =>
    sec.questionIds.some(qid =>
      answers.some(a => a.question_id === qid && (a.value_text || a.value_json))
    )
  ).length;
  return { done, total: SECTIONS.length };
}

// ─── RENDER: BANNER ──────────────────────────────────────────────────────────
function renderBanner(lang) {
  return `
    <div class="disc-banner" role="banner">
      <div class="disc-banner__langtoggle disc-langtoggle" aria-label="Language toggle">
        <button class="disc-langtoggle__btn${lang === 'en' ? ' disc-langtoggle__btn--active' : ''}"
          aria-pressed="${lang === 'en'}" data-lang="en" type="button">EN</button>
        <span class="disc-langtoggle__sep" aria-hidden="true">|</span>
        <button class="disc-langtoggle__btn${lang === 'es' ? ' disc-langtoggle__btn--active' : ''}"
          aria-pressed="${lang === 'es'}" data-lang="es" type="button">ES</button>
      </div>
      <p class="disc-banner__eyebrow">// V01 · DISCOVERY</p>
    </div>
  `;
}

// ─── RENDER: HEADER ROW ───────────────────────────────────────────────────────
function renderHeader(prospect) {
  const av = initials(prospect);
  const subParts = [];
  if (prospect.role) subParts.push(esc(lookupLabel('role', prospect.role)));
  if (prospect.company) subParts.push(esc(prospect.company));
  const callLabel = prospect.calendly_url ? 'Manage call →' : t('profile.book');
  const callHref = prospect.calendly_url || 'https://calendly.com/rafaelschwart/discovery';

  // Editing mode: full identity form. View mode: name + sub + edit pencil.
  if (state.editingIdentity) {
    return `
      <div class="disc-head disc-head--editing">
        <div class="disc-avatar" aria-hidden="true">${esc(av)}</div>
        <form class="disc-head__edit-form" id="identity-form">
          <div class="disc-head__edit-grid">
            <label class="disc-field">
              <span class="disc-field__label">${getLang() === 'es' ? 'Nombre' : 'Name'}</span>
              <input class="disc-input" name="name" type="text" value="${esc(prospect.name || '')}" placeholder="${getLang() === 'es' ? 'Tu nombre' : 'Your name'}" autocomplete="name" />
            </label>
            <label class="disc-field">
              <span class="disc-field__label">Email</span>
              <input class="disc-input" name="email" type="email" value="${esc(prospect.email || '')}" placeholder="you@company.com" autocomplete="email" />
            </label>
            <label class="disc-field">
              <span class="disc-field__label">${getLang() === 'es' ? 'Empresa' : 'Company'}</span>
              <input class="disc-input" name="company" type="text" value="${esc(prospect.company || '')}" placeholder="${getLang() === 'es' ? 'Tu empresa' : 'Your company'}" autocomplete="organization" />
            </label>
            <label class="disc-field">
              <span class="disc-field__label">${getLang() === 'es' ? 'Rol' : 'Role'}</span>
              <select class="disc-select" name="role">
                <option value="">—</option>
                ${['ceo','coo','ops','finance','other'].map(v =>
                  `<option value="${esc(v)}"${prospect.role === v ? ' selected' : ''}>${esc(lookupLabel('role', v))}</option>`
                ).join('')}
              </select>
            </label>
            <label class="disc-field disc-field--wide">
              <span class="disc-field__label">${getLang() === 'es' ? 'WhatsApp' : 'WhatsApp / Phone'}</span>
              <input class="disc-input" name="phone" type="tel" value="${esc(prospect.phone || '')}" placeholder="+57 310 555 1234" autocomplete="tel" />
            </label>
          </div>
          <div class="disc-head__edit-actions">
            <button type="button" class="disc-btn disc-btn--ghost disc-btn--small" id="identity-cancel">${t('profile.cancel')}</button>
            <button type="submit" class="disc-btn disc-btn--primary disc-btn--small" id="identity-save">${t('profile.save')}</button>
          </div>
          <p class="disc-head__edit-error" id="identity-error" hidden></p>
        </form>
      </div>
    `;
  }

  return `
    <div class="disc-head">
      <div class="disc-avatar" aria-hidden="true">${esc(av)}</div>
      <div class="disc-head__info">
        <div class="disc-head__name-row">
          <h1 class="disc-head__name">${esc(prospect.name || prospect.email || prospect.company || (getLang() === 'es' ? 'Perfil de descubrimiento' : 'Discovery profile'))}</h1>
          <button type="button" class="disc-head__edit-btn" id="btn-edit-identity" aria-label="${getLang() === 'es' ? 'Editar perfil' : 'Edit profile'}" title="${getLang() === 'es' ? 'Editar nombre, email, teléfono' : 'Edit name, email, phone'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" aria-hidden="true">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>
        </div>
        <div class="disc-head__sub">
          ${subParts.join(' <span aria-hidden="true">·</span> ')}
          ${prospect.sector_id ? `<span class="disc-chip--sector">${esc(lookupLabel('industry', prospect.sector_id))}</span>` : ''}
        </div>
        ${prospect.email || prospect.phone ? `
          <p class="disc-head__contact">
            ${prospect.email ? `<span>${esc(prospect.email)}</span>` : ''}
            ${prospect.email && prospect.phone ? '<span aria-hidden="true">·</span>' : ''}
            ${prospect.phone ? `<span>${esc(prospect.phone)}</span>` : ''}
          </p>
        ` : ''}
      </div>
      <div class="disc-head__actions">
        ${!state.passwordSet
          ? `<button type="button" class="disc-btn disc-btn--ghost disc-btn--small" id="btn-set-password">${t('profile.set_password')}</button>`
          : `<span class="disc-pw-state" aria-label="${esc(t('profile.password_set'))}">${ICON_CHECK}<span>${esc(t('profile.password_set'))}</span></span>`
        }
        <a href="${esc(callHref)}" target="_blank" rel="noopener" class="disc-btn disc-btn--primary disc-btn--small">
          ${esc(callLabel)}
        </a>
      </div>
    </div>
  `;
}

// ─── RENDER: TABS ────────────────────────────────────────────────────────────
function renderTabs(activeTab) {
  return `
    <nav class="disc-tabs" aria-label="Profile sections" role="tablist">
      <button type="button" role="tab" class="disc-tab${activeTab === 'profile' ? ' disc-tab--active' : ''}"
        aria-selected="${activeTab === 'profile'}" aria-controls="panel-profile" id="tab-profile"
        data-tab="profile">${t('profile.tab.profile')}</button>
      <button type="button" role="tab" class="disc-tab${activeTab === 'next' ? ' disc-tab--active' : ''}"
        aria-selected="${activeTab === 'next'}" aria-controls="panel-next" id="tab-next"
        data-tab="next">${t('profile.tab.next')}</button>
    </nav>
  `;
}

// ─── RENDER: AI SUMMARY CARD ─────────────────────────────────────────────────
function renderSummaryCard(summary) {
  const text = summary
    ? sanitizeSummary(summary.summary_text)
    : '<em>Summary not yet generated. Complete your profile and click Regenerate.</em>';

  return `
    <section class="disc-summary" aria-label="AI Summary">
      <div class="disc-summary__head">
        <p class="disc-summary__eyebrow">${t('profile.summary_eyebrow')}</p>
        <button type="button" class="disc-summary__regen" id="btn-regen" aria-label="Regenerate AI summary">
          ${t('profile.regenerate')}
        </button>
      </div>
      <p class="disc-summary__text">${text}</p>
    </section>
  `;
}

// ─── RENDER: SET PASSWORD PANEL ───────────────────────────────────────────────
function renderPasswordPanel() {
  const prospect = state.profile?.prospect || {};
  const email = prospect.email || '';
  return `
    <section class="disc-summary" id="panel-set-password" aria-label="Set password" style="border-color:var(--arq);">
      <p class="disc-summary__eyebrow">${esc(t('profile.set_pw.eye'))}</p>
      <p class="disc-summary__sub" style="margin:6px 0 0;color:rgba(255,255,255,.68);font-size:13px;line-height:1.5;">
        ${esc(t('profile.set_pw.sub'))}
      </p>
      <form id="form-set-password" novalidate style="display:grid;gap:16px;margin-top:16px;">
        <div class="disc-field">
          <label class="disc-field__label" for="input-email-display">${esc(t('profile.set_pw.email_label'))}</label>
          <input class="disc-input" id="input-email-display" type="email" value="${esc(email)}" readonly autocomplete="username"
            style="opacity:.7;cursor:not-allowed;" />
          <span class="disc-field__hint" style="font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;color:rgba(255,255,255,.42);">
            ${esc(t('profile.set_pw.email_hint'))}
          </span>
        </div>
        <div class="disc-field">
          <label class="disc-field__label" for="input-password">${esc(t('profile.set_pw.password'))}</label>
          <input class="disc-input" id="input-password" name="password" type="password"
            minlength="8" autocomplete="new-password" required />
          <span class="disc-field__error" id="pw-error" aria-live="polite" style="display:none;"></span>
        </div>
        <div style="display:flex;gap:8px;">
          <button type="submit" class="disc-btn disc-btn--primary disc-btn--small">${t('profile.save')}</button>
          <button type="button" class="disc-btn disc-btn--ghost disc-btn--small" id="btn-cancel-pw">${t('profile.cancel')}</button>
        </div>
      </form>
    </section>
  `;
}

// ─── QUALITY SCORER ──────────────────────────────────────────────────────────
// Tells the prospect whether their answers in a section are detailed enough
// for the agent suite to produce strong demo output. Returns
// { level: 'green'|'amber'|'red', tip: <localized string> }.
//
// Why these thresholds? Looking at what each agent needs to NOT be generic:
//   - kpi_designer/headline_writer need a concrete metric+target (Q8)
//   - recommendations_generator + roadmap_architect need NAMED tools (Q5)
//   - process_optimizer needs the painful process described in concrete terms
//     (not "general operations" — specific systems and steps)
//   - risk_analyzer + roi_calculator need quantified hours (Q4)
function wordCount(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}
function isFilledStr(s, minWords = 1) {
  return typeof s === 'string' && wordCount(s) >= minWords;
}
function mentionsTool(text) {
  if (!text) return false;
  // Common ERP/CRM/ops tools that appear in LATAM mid-market
  return /\b(sap|oracle|netsuite|quickbooks|odoo|salesforce|hubspot|monday|whatsapp|excel|spreadsheet|sheets|notion|airtable|zoho|business one|b1|microsoft|365|drive|email|outlook|pipedrive)\b/i.test(text);
}
function scoreSection(sec, answers, prospect) {
  const lang = getLang();
  const a = id => answers.find(x => x.question_id === id) || {};
  const Q1 = a('Q1').value_json || {};
  const Q2 = a('Q2').value_text || '';
  const Q3 = a('Q3').value_json || {};
  const Q4 = a('Q4').value_text || '';
  const Q5 = a('Q5').value_json || {};
  const Q6 = a('Q6').value_text || '';
  const Q7 = a('Q7').value_json || {};
  const Q8 = a('Q8').value_json || {};
  const Q9 = a('Q9').value_json || {};
  const Q10= a('Q10').value_json || {};

  switch (sec.id) {
    case 'business': {
      const ok = Q1.industry && Q1.headcount && isFilledStr(Q2, 12);
      const great = ok && wordCount(Q2) >= 20;
      if (great) return { level: 'green', tip: lang === 'es' ? 'Sólido — el agente tiene contexto suficiente.' : 'Solid — agents have enough context here.' };
      if (ok)    return { level: 'amber', tip: lang === 'es' ? 'Bien. Agregar 1 frase sobre qué vendes y a quién mejora el output.' : 'Good. Adding one sentence on what you sell and to whom sharpens the output.' };
      return { level: 'red', tip: lang === 'es' ? 'Falta detalle: di al menos 20 palabras sobre qué hace tu empresa, industria y tamaño de equipo.' : 'Needs detail: write 20+ words about what your company does + industry + team size.' };
    }
    case 'operations': {
      const proc = Q3.process || '';
      const hasProc = isFilledStr(proc, 5);
      const hours  = isFilledStr(Q4, 1);
      const specific = mentionsTool(proc) || (Q3.chips && Q3.chips.length >= 2);
      if (hasProc && hours && specific) return { level: 'green', tip: lang === 'es' ? 'Perfecto — proceso, herramientas y horas claros.' : 'Perfect — process, tools, and hours are all clear.' };
      if (hasProc && hours)             return { level: 'amber', tip: lang === 'es' ? 'Nombra la herramienta o sistema específico que está rompiendo el proceso.' : 'Name the specific tool or system that breaks the process.' };
      return { level: 'red', tip: lang === 'es' ? 'Describe el proceso doloroso (≥5 palabras) y cuántas horas/semana consume.' : 'Describe the painful process (5+ words) and how many hours/week it eats.' };
    }
    case 'tools': {
      const tools = Array.isArray(Q5.tools) ? Q5.tools : [];
      const namedERP = isFilledStr(Q5.erp_name, 1);
      const namedCRM = isFilledStr(Q5.crm_name, 1);
      const hasData  = isFilledStr(Q6, 1);
      if (tools.length >= 2 && (namedERP || namedCRM) && hasData) return { level: 'green', tip: lang === 'es' ? 'Excelente — sistemas con nombre específico.' : 'Excellent — systems named specifically.' };
      if (tools.length >= 2) return { level: 'amber', tip: lang === 'es' ? 'Agrega el nombre exacto de tu ERP/CRM (ej: SAP Business One, no solo "ERP").' : 'Add the exact name of your ERP/CRM (e.g. "SAP Business One", not just "ERP").' };
      return { level: 'red', tip: lang === 'es' ? 'Lista al menos 2 herramientas concretas que tocan este proceso.' : 'List at least 2 concrete tools that touch this process.' };
    }
    case 'goals': {
      const metric = Q8.metric || '';
      const target = Q8.target || '';
      const hasMetric = isFilledStr(metric, 2);
      const hasTarget = /\d/.test(target);
      const fix       = Q7.fix || '';
      if (hasMetric && hasTarget && isFilledStr(fix, 5)) return { level: 'green', tip: lang === 'es' ? 'Sólido — métrica + objetivo + plan de 90 días.' : 'Solid — metric + target + 90-day plan all present.' };
      if (hasMetric && hasTarget) return { level: 'amber', tip: lang === 'es' ? 'Agrega una frase sobre qué arreglarías primero en 90 días.' : 'Add a sentence about what you\'d fix first in 90 days.' };
      return { level: 'red', tip: lang === 'es' ? 'Nombra una métrica concreta con números: actual → objetivo (ej: "3 días → 4 horas").' : 'Name a concrete metric with numbers: current → target (e.g. "3 days → 4 hours").' };
    }
    case 'you': {
      const role     = isFilledStr(Q9.role, 1);
      const du       = isFilledStr(Q9.decision_unit, 1);
      const phone    = isFilledStr(Q10.phone, 1) || isFilledStr(prospect?.phone, 1);
      if (role && du && phone) return { level: 'green', tip: lang === 'es' ? 'Todo claro.' : 'All set.' };
      if (role && du)          return { level: 'amber', tip: lang === 'es' ? 'Agrega un WhatsApp o teléfono de contacto.' : 'Add a WhatsApp / phone for follow-up.' };
      return { level: 'red', tip: lang === 'es' ? 'Necesitamos tu rol y quién más decide.' : 'We need your role and who else makes the call.' };
    }
    default:
      return { level: 'amber', tip: '' };
  }
}

// Quality-badge icons rendered as inline SVGs (Lucide-style) so they match the
// rest of the page's icon vocabulary. The labels themselves are plain text —
// no leading glyph in the string.
const QUALITY_LABEL = {
  green: { en: 'Strong',         es: 'Sólido' },
  amber: { en: 'Could improve',  es: 'Mejorable' },
  red:   { en: 'Add detail',     es: 'Falta detalle' }
};
const QUALITY_ICON = {
  green: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  amber: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  red:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
};
const ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
const ICON_MIC    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
const ICON_LOCK   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const ICON_CHECK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

// ─── RENDER: SECTION CARD ─────────────────────────────────────────────────────
function renderSectionCard(sec, answers, isExpanded) {
  const summary = sec.summarize(answers);
  const prospect = state.profile?.prospect;
  const q = scoreSection(sec, answers, prospect);
  const langCode = getLang();
  const qLabel = QUALITY_LABEL[q.level][langCode];
  const qIcon  = QUALITY_ICON[q.level];
  const talkLang = langCode === 'es' ? 'Hablar con la IA' : 'Talk to AI';
  return `
    <article class="disc-section-card${isExpanded ? ' disc-section-card--editing' : ''}"
      data-section="${esc(sec.id)}" data-section-id="${esc(sec.id)}" aria-label="${esc(t(sec.labelKey))} section">
      <div class="disc-section-card__head" role="button" tabindex="0"
        aria-expanded="${isExpanded}" data-toggle-section="${esc(sec.id)}">
        <span class="disc-section-card__num">${esc(sec.num)}</span>
        <h2 class="disc-section-card__title">
          ${esc(t(sec.labelKey))}
          <span class="disc-section-card__sub">${esc(summary)}</span>
        </h2>
        <span class="disc-quality disc-quality--${q.level}" title="${esc(q.tip)}" aria-label="${esc(q.tip)}">
          <span class="disc-quality__icon">${qIcon}</span>
          <span class="disc-quality__label">${esc(qLabel)}</span>
        </span>
        <button type="button" class="disc-section-card__edit" data-edit-section="${esc(sec.id)}"
          aria-label="Edit ${esc(t(sec.labelKey))}">
          ${isExpanded ? t('profile.cancel') : t('profile.edit')}
        </button>
      </div>
      ${!isExpanded && q.level !== 'green' ? `
        <div class="disc-section-card__guide disc-section-card__guide--${q.level}">
          <p class="disc-section-card__guide-tip">${esc(q.tip)}</p>
          <div class="disc-section-card__guide-actions">
            <button type="button" class="disc-btn disc-btn--ghost disc-btn--small disc-btn--with-icon" data-edit-section="${esc(sec.id)}">
              ${ICON_PENCIL}<span>${esc(langCode === 'es' ? 'Editar' : 'Edit')}</span>
            </button>
            <button type="button" class="disc-btn disc-btn--primary disc-btn--small disc-btn--with-icon" data-talk-section="${esc(sec.id)}">
              ${ICON_MIC}<span>${esc(talkLang)}</span>
            </button>
          </div>
        </div>
      ` : ''}
      ${isExpanded ? `
        <form class="disc-section-card__body" data-section-form="${esc(sec.id)}" novalidate>
          ${sec.renderInputs(answers)}
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button type="submit" class="disc-btn disc-btn--primary disc-btn--small">${t('profile.save')}</button>
            <button type="button" class="disc-btn disc-btn--ghost disc-btn--small"
              data-cancel-section="${esc(sec.id)}">${t('profile.cancel')}</button>
          </div>
        </form>
      ` : ''}
    </article>
  `;
}

// ─── RENDER: COMPLETENESS RAIL CARD ──────────────────────────────────────────
function renderCompletenessCard(answers) {
  const { done, total } = completenessCount(answers);
  const pct = Math.round((done / total) * 100);
  // Build a tiny sparkline of section-by-section completion (used as a soft progress glyph).
  // Each section's answered ratio becomes a y-value on the line.
  const spark = renderCompletenessSparkline(answers);
  return `
    <div class="disc-rail-card" aria-label="Profile completeness">
      <p class="disc-rail-card__eyebrow">${t('profile.demo_prep_eyebrow')}</p>
      <p class="disc-rail-card__title" style="font-size:22px;font-variant-numeric:tabular-nums;">
        <span data-count-target="${done}">0</span> / ${total}
        <span style="color:rgba(255,255,255,.4);font-family:var(--font-mono);font-size:12px;letter-spacing:.12em;margin-left:8px;">
          <span data-count-target="${pct}" data-count-suffix="%">0%</span>
        </span>
      </p>
      <div class="disc-completeness__bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Profile completion ${pct}%">
        <i style="width:${pct}%;"></i>
      </div>
      ${spark}
      <p class="disc-completeness__copy">${t('profile.demo_prep')}</p>
    </div>
  `;
}

// V2 polish: mini sparkline of section-by-section completion. Each section contributes
// one point on a 6-segment path; y = (answered / sectionTotal) * graphHeight.
function renderCompletenessSparkline(answers) {
  if (!Array.isArray(SECTIONS) || !SECTIONS.length) return '';
  const w = 240, h = 32, pad = 2;
  const stepX = (w - pad * 2) / Math.max(1, SECTIONS.length - 1);
  const points = SECTIONS.map((sec, i) => {
    const ids = sec.questionIds || sec.questions || [];
    const total = ids.length || 1;
    const filled = ids.filter(qid => answers.some(a => a.question_id === qid && (a.value_text || a.value_json))).length;
    const ratio = total ? filled / total : 0;
    const x = pad + i * stepX;
    const y = h - pad - ratio * (h - pad * 2);
    return [x, y];
  });
  const d = points.map((p, i) => (i === 0 ? `M${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`)).join(' ');
  return `<svg class="disc-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true" preserveAspectRatio="none"><path d="${d}"/></svg>`;
}

// ─── RENDER: BOOKED CALL CARD ────────────────────────────────────────────────
function renderCallCard(prospect) {
  if (!prospect.calendly_url) return '';
  const date = parseCalendlyDate(prospect.calendly_url);
  const timeStr = date ? formatCallTime(date) : '—';
  const dateStr = date ? formatCallDate(date) : '—';
  return `
    <div class="disc-rail-card disc-rail-card--call" aria-label="Your discovery call">
      <p class="disc-rail-card__eyebrow">${t('profile.call_eyebrow')}</p>
      <p class="disc-call__when">${esc(timeStr)} <em>${esc(dateStr)}</em></p>
      <div class="disc-call__actions">
        <a href="${esc(prospect.calendly_url)}" target="_blank" rel="noopener"
          class="disc-btn disc-btn--ghost-dark disc-btn--small">
          ${t('profile.reschedule')}
        </a>
      </div>
    </div>
  `;
}

// ─── RENDER: TIPS RAIL CARD ───────────────────────────────────────────────────
function renderTipsCard() {
  return `
    <div class="disc-rail-card disc-rail-card--tips" aria-label="What to expect">
      <p class="disc-rail-card__eyebrow">${t('profile.tips_eyebrow')}</p>
      <ul>
        <li>${esc(t('profile.tips.1'))}</li>
        <li>${esc(t('profile.tips.2'))}</li>
        <li>${esc(t('profile.tips.3'))}</li>
      </ul>
    </div>
  `;
}

// ─── RENDER: COMPLETION GATE ─────────────────────────────────────────────────
// Top-of-tab banner: shows completion % + unlocks the personalized demo when
// all required fields are filled. When incomplete, lists missing fields with
// "Type it" buttons (expands the right section) and a "Talk to AI" button
// (rate-limited, ${voice_fill.attempts_remaining}/3 per 6h).
function renderCompletionGate(prospect, completeness, voice_fill, acknowledged_at) {
  if (!completeness) return '';
  const lang = getLang();
  const pct = completeness.percent;
  const isAcknowledged = !!acknowledged_at;
  const calendlyUrl = prospect.calendly_url || 'https://calendly.com/rafaelschwart/discovery';

  // ── STATE C: Profile complete AND acknowledged ──────────────────────────
  // Prospect has reviewed and confirmed. Locked in. Big "ready for call" badge.
  // They can still hit "I need to change something" to unlock for edits.
  if (completeness.complete && isAcknowledged) {
    return `
      <section class="disc-gate disc-gate--locked-in" aria-label="Profile locked in">
        <p class="disc-gate__eye">${esc(t('profile.gate.lockedin.eye'))}</p>
        <h2 class="disc-gate__title">${esc(t('profile.gate.lockedin.title'))}</h2>
        <p class="disc-gate__sub">${esc(t('profile.gate.lockedin.sub'))}</p>
        <div class="disc-gate__bar" aria-hidden="true"><i style="width:100%;"></i></div>
        <div class="disc-gate__cta-row">
          <a href="${esc(calendlyUrl)}" target="_blank" rel="noopener" class="disc-btn disc-btn--primary disc-gate__cta">${esc(t('profile.gate.lockedin.book'))}</a>
          <button type="button" class="disc-btn disc-btn--ghost disc-btn--small" id="btn-unacknowledge">${esc(t('profile.gate.lockedin.unlock'))}</button>
        </div>
      </section>
    `;
  }

  // ── STATE B: Profile complete, NOT yet acknowledged ─────────────────────
  // Two presentations:
  //   (default) Big "review your profile" panel — first thing they see
  //   (after pressing "Take me to my answers") Collapsed: just a slim sticky
  //     bar at the bottom with the confirm CTA, so the dashboard becomes the
  //     focus while still keeping confirm one click away.
  if (completeness.complete && !isAcknowledged) {
    if (state.reviewGateDismissed) {
      return `
        <div class="disc-gate-sticky" aria-label="Review your profile">
          <div class="disc-gate-sticky__inner">
            <p class="disc-gate-sticky__msg">
              <span class="disc-gate-sticky__eye">${esc(t('profile.gate.review.eye'))}</span>
              ${esc(t('profile.gate.review.sticky_msg'))}
            </p>
            <div class="disc-gate-sticky__actions">
              <button type="button" class="disc-btn disc-btn--ghost disc-btn--small" id="btn-show-review-gate">
                ${esc(t('profile.gate.review.show_again'))}
              </button>
              <button type="button" class="disc-btn disc-btn--primary disc-btn--small" id="btn-acknowledge">
                ${esc(t('profile.gate.review.confirm_cta'))}
              </button>
            </div>
          </div>
        </div>
      `;
    }
    return `
      <section class="disc-gate disc-gate--review" aria-label="Profile ready to confirm">
        <p class="disc-gate__eye">${esc(t('profile.gate.review.eye'))}</p>
        <h2 class="disc-gate__title">${esc(t('profile.gate.review.title'))}</h2>
        <p class="disc-gate__sub">${esc(t('profile.gate.review.sub'))}</p>
        <div class="disc-gate__bar" aria-hidden="true"><i style="width:100%;"></i></div>
        <div class="disc-gate__steps">
          <p class="disc-gate__step">${esc(t('profile.gate.review.step1'))}</p>
          <p class="disc-gate__step">${esc(t('profile.gate.review.step2'))}</p>
          <p class="disc-gate__step">${esc(t('profile.gate.review.step3'))}</p>
        </div>
        <div class="disc-gate__cta-row">
          <button type="button" class="disc-btn disc-btn--ghost disc-gate__cta-secondary" id="btn-scroll-to-sections">
            ${esc(t('profile.gate.review.scroll_cta'))}
          </button>
          <button type="button" class="disc-btn disc-btn--primary disc-gate__cta" id="btn-acknowledge">
            ${esc(t('profile.gate.review.confirm_cta'))}
          </button>
        </div>
      </section>
    `;
  }

  // LOCKED state — show missing required fields with Type it / Talk to AI buttons
  const missing = completeness.missing || [];
  const missingOpt = completeness.missing_optional || [];
  const remaining = voice_fill?.attempts_remaining ?? 3;
  const talkLabel = remaining > 0
    ? t('profile.gate.talk_remaining').replace('{n}', remaining)
    : t('profile.gate.talk_used_up').replace('{h}', voice_fill?.window_hours ?? 6);

  const missingItems = missing.map(f => `
    <li class="disc-gate__miss">
      <span class="disc-gate__miss-label">${esc(lang === 'es' ? f.label_es : f.label_en)}</span>
      <div class="disc-gate__miss-actions">
        <button type="button" class="disc-btn disc-btn--ghost disc-btn--small"
          data-gate-type="${esc(f.q_id || '')}">${esc(t('profile.gate.type_it'))}</button>
        <button type="button" class="disc-btn disc-btn--primary disc-btn--small"
          data-gate-talk="${esc(f.q_id || '')}" ${remaining <= 0 ? 'disabled' : ''}>${esc(t('profile.gate.talk_to_ai'))}</button>
      </div>
    </li>
  `).join('');

  return `
    <section class="disc-gate disc-gate--locked" aria-label="Profile completion">
      <div class="disc-gate__head">
        <p class="disc-gate__eye">${esc(t('profile.gate.locked.eye'))}</p>
        <p class="disc-gate__pct">${pct}<span>%</span></p>
      </div>
      <h2 class="disc-gate__title">${esc(t('profile.gate.locked.title'))}</h2>
      <p class="disc-gate__sub">${esc(t('profile.gate.locked.sub').replace('{n}', missing.length))}</p>
      <div class="disc-gate__bar" aria-hidden="true"><i style="width:${pct}%;"></i></div>

      <p class="disc-gate__list-title">${esc(t('profile.gate.missing_title'))} (${missing.length})</p>
      <ul class="disc-gate__list">${missingItems}</ul>

      <p class="disc-gate__talk-status">${esc(talkLabel)}</p>

      ${missingOpt.length ? `
        <details class="disc-gate__optional">
          <summary>
            <span class="disc-gate__opt-eye">${esc(t('profile.gate.optional_eye'))}</span>
            <span class="disc-gate__opt-count">${missingOpt.length}</span>
          </summary>
          <p class="disc-gate__opt-sub">${esc(t('profile.gate.optional_sub'))}</p>
          <ul class="disc-gate__list disc-gate__list--opt">
            ${missingOpt.map(f => `
              <li class="disc-gate__miss">
                <span class="disc-gate__miss-label">${esc(lang === 'es' ? f.label_es : f.label_en)}</span>
                <button type="button" class="disc-btn disc-btn--ghost disc-btn--small"
                  data-gate-type="${esc(f.q_id || '')}">${esc(t('profile.gate.type_it'))}</button>
              </li>
            `).join('')}
          </ul>
        </details>
      ` : ''}
    </section>
  `;
}

// ─── RENDER: PROFILE TAB ─────────────────────────────────────────────────────
function renderProfileTab(profile, showPasswordPanel) {
  const { prospect, answers, summary, completeness, voice_fill, acknowledged_at, has_password } = profile;

  // ── HARD GATE ──────────────────────────────────────────────────────────────
  // Until the prospect has an email + password set, they CANNOT see anything
  // else. This guarantees a sign-in identity exists in Supabase before they
  // start editing answers (otherwise they have no way to come back).
  if (!has_password) {
    return `
      <div class="disc-profile__body disc-profile__body--gated" id="panel-profile" role="tabpanel" aria-labelledby="tab-profile">
        <main class="disc-profile__gate-wrap">
          ${renderFirstTimeSetup(prospect)}
        </main>
      </div>
    `;
  }

  const sectionCards = SECTIONS.map(sec =>
    renderSectionCard(sec, answers, state.expandedSection === sec.id)
  ).join('');

  return `
    <div class="disc-profile__body" id="panel-profile" role="tabpanel" aria-labelledby="tab-profile">
      <main class="disc-profile__main">
        ${showPasswordPanel ? renderPasswordPanel() : ''}
        ${renderCompletionGate(prospect, completeness, voice_fill, acknowledged_at)}
        ${renderSummaryCard(summary)}
        ${sectionCards}
      </main>
      <aside class="disc-rail" aria-label="Profile sidebar">
        ${renderCompletenessCard(answers)}
        ${renderCallCard(prospect)}
        ${renderLockedDemoCard()}
        ${renderTipsCard()}
      </aside>
    </div>
  `;
}

// First-time setup screen — full-page, mandatory, blocks everything else.
// Sets email (editable, pre-filled from Q0 capture) + password in one go.
function renderFirstTimeSetup(prospect) {
  const email = prospect.email || '';
  // Personalize the gate — most prospects land here right after their voice
  // call, so it shouldn't feel like a generic signup. Use first name +
  // company if we have them.
  const firstName = (prospect.name || '').trim().split(/\s+/)[0] || '';
  const company   = prospect.company || '';
  const greetKey  = firstName && company
    ? 'profile.firstrun.greet_full'      // "Hi {name} — your {company} profile is ready."
    : firstName
      ? 'profile.firstrun.greet_name'    // "Hi {name} — your profile is ready."
      : 'profile.firstrun.greet_fallback'; // generic fallback
  const greet = t(greetKey, { name: firstName, company });
  return `
    <section class="disc-firstrun" aria-label="Set up your sign-in">
      <div class="disc-firstrun__card">
        ${greet ? `<p class="disc-firstrun__greet">${esc(greet)}</p>` : ''}
        <p class="disc-firstrun__eye">${esc(t('profile.firstrun.eye'))}</p>
        <h1 class="disc-firstrun__title">${esc(t('profile.firstrun.title'))}</h1>
        <p class="disc-firstrun__sub">${esc(t('profile.firstrun.sub'))}</p>

        <form id="form-firstrun" novalidate class="disc-firstrun__form">
          <div class="disc-field">
            <label class="disc-field__label" for="fr-email">${esc(t('profile.firstrun.email'))}</label>
            <input class="disc-input" id="fr-email" name="email" type="email"
              value="${esc(email)}" required autocomplete="email"
              placeholder="${esc(t('profile.firstrun.email_placeholder'))}" />
          </div>
          <div class="disc-field">
            <label class="disc-field__label" for="fr-password">${esc(t('profile.firstrun.password'))}</label>
            <input class="disc-input" id="fr-password" name="password" type="password"
              minlength="8" required autocomplete="new-password"
              placeholder="${esc(t('profile.firstrun.password_placeholder'))}" />
            <span class="disc-field__hint">${esc(t('profile.firstrun.password_hint'))}</span>
          </div>
          <p class="disc-firstrun__err" id="fr-error" role="alert" hidden></p>
          <button type="submit" class="disc-btn disc-btn--primary disc-firstrun__cta" id="fr-submit">
            ${esc(t('profile.firstrun.cta'))}
          </button>
          <ul class="disc-firstrun__trust" aria-label="${esc(t('profile.firstrun.trust.aria'))}">
            <li><span class="disc-firstrun__trust-icon">${ICON_CHECK}</span><span>${esc(t('profile.firstrun.trust.no_spam'))}</span></li>
            <li><span class="disc-firstrun__trust-icon">${ICON_CHECK}</span><span>${esc(t('profile.firstrun.trust.fast'))}</span></li>
            <li><span class="disc-firstrun__trust-icon">${ICON_CHECK}</span><span>${esc(t('profile.firstrun.trust.delete'))}</span></li>
          </ul>
        </form>
      </div>
    </section>
  `;
}

// Prominent banner shown when prospect hasn't set a password yet — invites
// them to set one so they can sign back in via /discovery/login later.
function renderPasswordPrompt() {
  const lang = getLang();
  return `
    <section class="disc-pw-nudge" aria-label="Set a password">
      <div class="disc-pw-nudge__icon" aria-hidden="true">${ICON_LOCK}</div>
      <div class="disc-pw-nudge__body">
        <p class="disc-pw-nudge__eye">${esc(t('profile.pw_nudge.eye'))}</p>
        <p class="disc-pw-nudge__title">${esc(t('profile.pw_nudge.title'))}</p>
        <p class="disc-pw-nudge__sub">${esc(t('profile.pw_nudge.sub'))}</p>
      </div>
      <button type="button" class="disc-btn disc-btn--primary disc-btn--small" id="btn-set-password-prompt">
        ${esc(t('profile.pw_nudge.cta'))}
      </button>
    </section>
  `;
}

// Locked demo card on the rail — informational only, no CTA. Prospect knows
// the personalized dashboard exists but only sees it during the live call.
function renderLockedDemoCard() {
  return `
    <div class="disc-rail-card disc-rail-card--demo-locked" aria-label="Demo dashboard">
      <p class="disc-rail-card__eyebrow">${esc(t('profile.demo_locked.eye'))}</p>
      <div class="disc-rail-card__lock-thumb" aria-hidden="true">
        <div class="disc-rail-card__lock-bars">
          <span></span><span></span><span></span>
        </div>
        <div class="disc-rail-card__lock-icon" aria-hidden="true">${ICON_LOCK}</div>
      </div>
      <p class="disc-rail-card__title">${esc(t('profile.demo_locked.title'))}</p>
      <p class="disc-rail-card__msg">${esc(t('profile.demo_locked.msg'))}</p>
    </div>
  `;
}

// ─── RENDER: NEXT STEPS TAB ───────────────────────────────────────────────────
function renderNextTab(profile) {
  const { prospect } = profile;
  const email = esc(prospect.email || 'hi@rafaelschwart.com');
  const phone = esc(prospect.phone || '');
  const waLink = phone ? `https://wa.me/${phone.replace(/[^0-9]/g,'')}` : '#';

  return `
    <div class="disc-profile__body" id="panel-next" role="tabpanel" aria-labelledby="tab-next">
      <main class="disc-profile__main" style="max-width:640px;">

        <section class="disc-summary" aria-label="Your discovery call">
          <p class="disc-summary__eyebrow">// YOUR DISCOVERY CALL</p>
          ${prospect.calendly_url
            ? renderCallCard(prospect)
            : `<p class="disc-body" style="margin-top:8px;">${t('profile.book')}</p>
               <a href="https://calendly.com/rafaelschwart/discovery" target="_blank" rel="noopener"
                 class="disc-btn disc-btn--primary disc-btn--small" style="margin-top:12px;">
                 ${t('profile.book')}
               </a>`
          }
        </section>

        <section class="disc-summary" aria-label="Prepare for the call">
          <p class="disc-summary__eyebrow">// PREPARE (5 MIN)</p>
          <ul style="list-style:none;padding:0;margin:12px 0 0;display:grid;gap:12px;">
            <li style="display:grid;grid-template-columns:16px 1fr;gap:8px;font-family:var(--font-body);font-size:13px;line-height:1.5;color:var(--ink-2);">
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--arq);padding-top:2px;">//</span>
              ${esc(t('profile.tips.1'))}
            </li>
            <li style="display:grid;grid-template-columns:16px 1fr;gap:8px;font-family:var(--font-body);font-size:13px;line-height:1.5;color:var(--ink-2);">
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--arq);padding-top:2px;">//</span>
              ${esc(t('profile.tips.2'))}
            </li>
            <li style="display:grid;grid-template-columns:16px 1fr;gap:8px;font-family:var(--font-body);font-size:13px;line-height:1.5;color:var(--ink-2);">
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--arq);padding-top:2px;">//</span>
              ${esc(t('profile.tips.3'))}
            </li>
          </ul>
        </section>

        <section class="disc-summary" aria-label="Resources">
          <p class="disc-summary__eyebrow">// RESOURCES</p>
          <ul style="list-style:none;padding:0;margin:12px 0 0;display:grid;gap:8px;">
            <li><a href="/" class="disc-summary__regen" style="font-size:12px;">Arqentia capabilities →</a></li>
            <li><a href="/#demo" class="disc-summary__regen" style="font-size:12px;">See live dashboard demo →</a></li>
          </ul>
        </section>

        <section class="disc-summary" aria-label="Contact Rafael">
          <p class="disc-summary__eyebrow">// CONTACT RAFAEL</p>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
            <a href="mailto:hi@rafaelschwart.com" class="disc-btn disc-btn--ghost disc-btn--small">
              <svg class="disc-icon disc-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="0" stroke-width="1.6"/>
                <path d="M2 4l10 9 10-9" stroke-width="1.6" stroke-linecap="square"/>
              </svg>
              hi@rafaelschwart.com
            </a>
            ${phone
              ? `<a href="${esc(waLink)}" target="_blank" rel="noopener" class="disc-btn disc-btn--ghost disc-btn--small">
                  <svg class="disc-icon disc-icon--sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path d="M3 21l1.65-4.14A8.5 8.5 0 113 12v0a8.46 8.46 0 001.65 5.14z" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="round"/>
                  </svg>
                  WhatsApp ${esc(phone)}
                </a>`
              : ''
            }
          </div>
        </section>

      </main>
    </div>
  `;
}

// ─── RENDER: ERROR STATES ─────────────────────────────────────────────────────
function renderError(type) {
  if (type === 'not_found') {
    return `
      <div style="min-height:100vh;display:grid;place-items:center;padding:48px 24px;text-align:center;">
        <div style="max-width:400px;">
          <p style="font-family:var(--font-mono);font-size:var(--text-mono);letter-spacing:var(--tr-mono);text-transform:uppercase;color:var(--ink-4);margin:0 0 16px;">// 404</p>
          <h1 style="font-family:var(--font-display);font-weight:600;font-size:var(--text-h3);color:var(--ink);margin:0 0 16px;">Profile not found.</h1>
          <a href="/discovery/login" class="disc-btn disc-btn--primary">Sign in →</a>
        </div>
      </div>
    `;
  }
  return `
    <div style="min-height:100vh;display:grid;place-items:center;padding:48px 24px;text-align:center;">
      <div style="max-width:400px;">
        <p style="font-family:var(--font-mono);font-size:var(--text-mono);letter-spacing:var(--tr-mono);text-transform:uppercase;color:var(--ink-4);margin:0 0 16px;">// NETWORK ERROR</p>
        <h1 style="font-family:var(--font-display);font-weight:600;font-size:var(--text-h3);color:var(--ink);margin:0 0 16px;">Couldn't load your profile.</h1>
        <button type="button" class="disc-btn disc-btn--primary" id="btn-retry">Try again</button>
      </div>
    </div>
  `;
}

// ─── RENDER: FULL PAGE ────────────────────────────────────────────────────────
function renderPage(showPasswordPanel = false) {
  if (state.error) {
    return renderError(state.error.type);
  }
  if (!state.profile) return '';

  const lang = getLang();
  const { prospect, answers } = state.profile;
  const tabContent = state.activeTab === 'profile'
    ? renderProfileTab(state.profile, showPasswordPanel)
    : renderNextTab(state.profile);

  return `
    ${renderBanner(lang)}
    ${renderHeader(prospect)}
    ${renderTabs(state.activeTab)}
    ${tabContent}
    ${state.isDemo ? renderDemoBadge() : ''}
  `;
}

// ─── MOUNT ───────────────────────────────────────────────────────────────────
function mount(html) {
  const root = document.getElementById('root');
  root.innerHTML = html;
  attachEvents();
  runPostMountAnimations(root);
}

// ─── POST-MOUNT ANIMATIONS ────────────────────────────────────────────────────
// Runs after every mount() call. Entry animations (banner, avatar, header, tabs,
// section cards, rail cards) only fire on the FIRST mount — subsequent re-mounts
// from edit-section or tab-switch skip the entrance and snap straight to final state.
// KPI count-up and sparkline draw also run on every mount so they stay correct
// after edits — but only if the rail card is freshly rendered.
function runPostMountAnimations(root) {
  const rm = RM.matches;

  // ── ENTRANCE (first paint only) ──────────────────────────────────────────
  if (!_hasAnimatedIn) {
    _hasAnimatedIn = true;

    if (!rm) {
      // Banner slides down and settles
      animate('.disc-banner', {
        opacity:    [0, 1],
        translateY: [-8, 0],
        duration: 600,
        ease: 'outQuart'
      });

      // Avatar springs in
      animate('.disc-avatar', {
        opacity: [0, 1],
        scale:   [0.7, 1],
        duration: 520,
        delay: 80,
        ease: 'outBack(1.7)'
      });

      // Header name / role fade-up
      animate('.disc-head__name, .disc-head__sub, .disc-head__actions', {
        opacity:    [0, 1],
        translateY: [10, 0],
        duration: 420,
        delay: stagger(60, { start: 160 }),
        ease: 'outCubic'
      });

      // Tabs fade in
      animate('.disc-tabs', {
        opacity: [0, 1],
        duration: 380,
        delay: 320,
        ease: 'outCubic'
      });

      // AI Summary card
      animate('.disc-summary', {
        opacity:    [0, 1],
        translateY: [16, 0],
        duration: 540,
        delay: 280,
        ease: 'outQuart'
      });

      // Section cards staggered
      animate('.disc-section-card', {
        opacity:    [0, 1],
        translateY: [14, 0],
        duration: 480,
        delay: stagger(90, { start: 360 }),
        ease: 'outQuart'
      });

      // Right-rail cards staggered
      animate('.disc-rail-card', {
        opacity:    [0, 1],
        translateY: [14, 0],
        duration: 500,
        delay: stagger(110, { start: 420 }),
        ease: 'outQuart'
      });
    }
  }

  // ── KPI COUNT-UP (every mount — snaps if RM) ──────────────────────────────
  root.querySelectorAll('[data-count-target]').forEach(node => {
    const target = parseFloat(node.dataset.countTarget) || 0;
    const suffix = node.dataset.countSuffix || '';
    if (rm) { node.textContent = `${Math.round(target)}${suffix}`; return; }
    const startTs = performance.now();
    const dur = 900; // 900ms outCubic, matches design-system §9.7
    function step(now) {
      const progress = Math.min(1, (now - startTs) / dur);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      node.textContent = `${Math.round(target * eased)}${suffix}`;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });

  // ── COMPLETENESS BAR (every mount) ───────────────────────────────────────
  // Uses transform:scaleX rather than width to keep it GPU-only.
  const bar = root.querySelector('.disc-completeness__bar > i');
  if (bar) {
    const targetPct = parseFloat(bar.style.width) / 100 || 0;
    if (rm) {
      bar.style.width = `${targetPct * 100}%`;
    } else {
      bar.style.width = '100%'; // keep the element full-width; control via scaleX
      bar.style.transformOrigin = 'left center';
      bar.style.transform = 'scaleX(0)';
      requestAnimationFrame(() => {
        bar.offsetWidth; // force layout
        bar.style.transition = 'transform 720ms var(--ease)';
        bar.style.transform = `scaleX(${targetPct})`;
      });
    }
  }

  // ── SPARKLINE DRAW (every mount, delay 400ms so card is visible first) ───
  root.querySelectorAll('.disc-spark path').forEach(p => {
    const len = p.getTotalLength ? p.getTotalLength() : 1000;
    p.style.strokeDasharray = String(len);
    if (rm) {
      p.style.strokeDashoffset = '0';
      return;
    }
    p.style.strokeDashoffset = String(len);
    setTimeout(() => {
      animate(p, {
        strokeDashoffset: [len, 0],
        duration: 1100,
        ease: 'inOutSine'
      });
    }, 400);
  });
}

// ─── ATTACH EVENTS ────────────────────────────────────────────────────────────
function attachEvents() {
  const root = document.getElementById('root');

  // Demo card review-as-rafael button
  root.querySelectorAll('[data-demo-review-href]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = btn.dataset.demoReviewHref;
    });
  });

  // Language toggle
  root.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      mount(renderPage());
    });
  });

  // Tab switching
  root.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      state.activeTab = tab;
      const sp = new URLSearchParams(location.search);
      if (tab === 'next') sp.set('tab', 'next');
      else sp.delete('tab');
      history.replaceState(null, '', `${location.pathname}${sp.toString() ? '?' + sp : ''}`);
      mount(renderPage());
    });
  });

  // Retry button (error state)
  const retryBtn = root.querySelector('#btn-retry');
  if (retryBtn) retryBtn.addEventListener('click', () => init());

  // Completion gate: "Type it" → expand the matching section card + scroll to it
  root.querySelectorAll('[data-gate-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qId = btn.dataset.gateType;
      const sec = SECTIONS.find(s => (s.questionIds || s.questions || []).includes(qId));
      if (!sec) return;
      state.expandedSection = sec.id;
      mount(renderPage());
      setTimeout(() => {
        const el = document.querySelector(`[data-section-id="${sec.id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    });
  });

  // Completion gate: "Talk to AI" → launch the voice-fill flow (Track A5)
  root.querySelectorAll('[data-gate-talk]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const token = getToken();
      window.location.href = `/discovery/voice?fill=${encodeURIComponent(token || '')}`;
    });
  });

  // Per-section "Talk to AI" → scoped voice-fill for that section's Q's only
  root.querySelectorAll('[data-talk-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      const secId = btn.dataset.talkSection;
      const token = getToken();
      window.location.href = `/discovery/voice?fill=${encodeURIComponent(token || '')}&section=${encodeURIComponent(secId)}`;
    });
  });

  // Identity edit: pencil → enter edit mode
  const editIdBtn = root.querySelector('#btn-edit-identity');
  if (editIdBtn) {
    editIdBtn.addEventListener('click', () => {
      state.editingIdentity = true;
      mount(renderPage());
      // Focus the first empty field, else the name
      setTimeout(() => {
        const form = document.getElementById('identity-form');
        if (!form) return;
        const fields = ['name', 'email', 'company', 'role', 'phone'];
        const first = fields.find(f => !form.elements[f]?.value) || 'name';
        form.elements[first]?.focus();
      }, 30);
    });
  }

  // Identity edit: cancel
  const idCancel = root.querySelector('#identity-cancel');
  if (idCancel) {
    idCancel.addEventListener('click', () => {
      state.editingIdentity = false;
      mount(renderPage());
    });
  }

  // Identity edit: save (PATCH /profile with { identity: {...} })
  const idForm = root.querySelector('#identity-form');
  if (idForm) {
    idForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(idForm);
      const identity = {
        name:    (fd.get('name')    || '').toString().trim(),
        email:   (fd.get('email')   || '').toString().trim(),
        company: (fd.get('company') || '').toString().trim(),
        role:    (fd.get('role')    || '').toString().trim(),
        phone:   (fd.get('phone')   || '').toString().trim()
      };
      const errEl = document.getElementById('identity-error');
      const saveBtn = document.getElementById('identity-save');
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }
      try {
        const token = getToken();
        const r = await api(`/profile?token=${encodeURIComponent(token)}`, {
          method: 'PATCH',
          body: { identity }
        });
        if (r?.prospect) state.profile.prospect = r.prospect;
        state.editingIdentity = false;
        mount(renderPage());
      } catch (err) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = err.status === 409
            ? (getLang() === 'es' ? 'Ese email ya está en uso por otro perfil.' : 'That email is already in use by another profile.')
            : (getLang() === 'es' ? 'No se pudo guardar. Intenta de nuevo.' : "Couldn't save. Try again.");
        }
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('profile.save'); }
      }
    });
  }

  // First-time setup form — collect email + password as a hard gate
  const frForm = root.querySelector('#form-firstrun');
  if (frForm) {
    frForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('fr-email');
      const pwInput = document.getElementById('fr-password');
      const errEl = document.getElementById('fr-error');
      const submitBtn = document.getElementById('fr-submit');
      const email = (emailInput?.value || '').trim();
      const password = pwInput?.value || '';
      const showErr = (msg) => { errEl.textContent = msg; errEl.hidden = false; };

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showErr(getLang() === 'es' ? 'Email inválido.' : 'Invalid email.');
        emailInput.focus();
        return;
      }
      if (password.length < 8) {
        showErr(getLang() === 'es' ? 'La contraseña necesita 8+ caracteres.' : 'Password needs 8+ characters.');
        pwInput.focus();
        return;
      }
      errEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '…';

      try {
        const token = getToken();
        // Step 1: persist email on the prospect record (idempotent — server
        // skips if same as existing; conflicts are handled with 409)
        if (email !== (state.profile?.prospect?.email || '')) {
          await api(`/profile?token=${encodeURIComponent(token)}`, {
            method: 'PATCH',
            body: { identity: { email } }
          });
          if (state.profile?.prospect) state.profile.prospect.email = email;
        }
        // Step 2: set password
        await api('/auth/password', { method: 'POST', body: { mode: 'set', password } });
        if (state.profile) state.profile.has_password = true;
        showToast(getLang() === 'es'
          ? `Listo — entra con ${email} + tu contraseña.`
          : `Done — sign in with ${email} + your password.`);
        mount(renderPage());
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = t('profile.firstrun.cta');
        if (err.status === 409) {
          showErr(getLang() === 'es' ? 'Ese email ya está en uso por otro perfil.' : 'That email is already used by another profile.');
        } else {
          showErr(getLang() === 'es' ? 'No se pudo guardar. Intenta de nuevo.' : "Couldn't save. Try again.");
        }
      }
    });
    // Autofocus the first empty input
    setTimeout(() => {
      const email = document.getElementById('fr-email');
      const pw = document.getElementById('fr-password');
      if (email && !email.value) email.focus();
      else if (pw) pw.focus();
    }, 30);
  }

  // Set password buttons (header + top-of-page prompt) — both open same panel
  const setPwBtn = root.querySelector('#btn-set-password');
  const setPwBtnPrompt = root.querySelector('#btn-set-password-prompt');
  const openPwPanel = () => {
    mount(renderPage(true));
    setTimeout(() => {
      const inp = document.getElementById('input-password');
      if (inp) inp.focus();
    }, 50);
  };
  if (setPwBtn) setPwBtn.addEventListener('click', openPwPanel);
  if (setPwBtnPrompt) setPwBtnPrompt.addEventListener('click', openPwPanel);

  // "Take me to my answers" → collapse the big gate to a slim sticky bar so
  // the section cards become the focus, then scroll the user to the top of
  // the answers area.
  const scrollBtn = root.querySelector('#btn-scroll-to-sections');
  if (scrollBtn) {
    scrollBtn.addEventListener('click', () => {
      state.reviewGateDismissed = true;
      mount(renderPage());
      // After re-render, scroll to the first section card (or summary card)
      setTimeout(() => {
        const target =
          document.querySelector('.disc-section-card') ||
          document.querySelector('.disc-summary') ||
          document.querySelector('.disc-profile__main');
        if (target) {
          const rect = target.getBoundingClientRect();
          window.scrollTo({ top: rect.top + window.pageYOffset - 16, behavior: 'smooth' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 40);
    });
  }

  // Sticky-bar "show full review again" button — restores the big gate
  const showGateBtn = root.querySelector('#btn-show-review-gate');
  if (showGateBtn) {
    showGateBtn.addEventListener('click', () => {
      state.reviewGateDismissed = false;
      mount(renderPage());
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 40);
    });
  }

  // Acknowledge profile → POST {action: 'acknowledge'}
  const ackBtn = root.querySelector('#btn-acknowledge');
  if (ackBtn) {
    ackBtn.addEventListener('click', async () => {
      ackBtn.disabled = true;
      ackBtn.textContent = '…';
      try {
        const token = getToken();
        const r = await api(`/profile?token=${encodeURIComponent(token)}`, {
          method: 'PATCH',
          body: { action: 'acknowledge' }
        });
        state.profile.acknowledged_at = r?.acknowledged_at || new Date().toISOString();
        mount(renderPage());
      } catch (err) {
        ackBtn.disabled = false;
        ackBtn.textContent = t('profile.gate.review.confirm_cta');
        showToast(getLang() === 'es' ? 'No se pudo confirmar — intenta de nuevo.' : "Couldn't confirm — try again.", 'error');
      }
    });
  }

  // Un-acknowledge → reopen editing
  const unackBtn = root.querySelector('#btn-unacknowledge');
  if (unackBtn) {
    unackBtn.addEventListener('click', async () => {
      unackBtn.disabled = true;
      try {
        const token = getToken();
        await api(`/profile?token=${encodeURIComponent(token)}`, {
          method: 'PATCH',
          body: { action: 'unacknowledge' }
        });
        state.profile.acknowledged_at = null;
        mount(renderPage());
      } catch (err) {
        unackBtn.disabled = false;
        showToast(getLang() === 'es' ? 'No se pudo actualizar.' : "Couldn't unlock.", 'error');
      }
    });
  }

  // Cancel password
  const cancelPwBtn = root.querySelector('#btn-cancel-pw');
  if (cancelPwBtn) cancelPwBtn.addEventListener('click', () => mount(renderPage(false)));

  // Set password form submit — username = email (set during voice/wizard).
  const pwForm = root.querySelector('#form-set-password');
  if (pwForm) {
    pwForm.addEventListener('submit', async e => {
      e.preventDefault();
      const pwInput = pwForm.querySelector('#input-password');
      const pwErr = pwForm.querySelector('#pw-error');
      const val = pwInput.value;
      if (val.length < 8) {
        pwErr.textContent = getLang() === 'es' ? 'Mínimo 8 caracteres.' : 'Min 8 characters required.';
        pwErr.style.display = 'block';
        pwInput.focus();
        return;
      }
      pwErr.style.display = 'none';
      if (state.isDemo) {
        showToast('Demo mode — changes not saved');
        state.passwordSet = false;
        mount(renderPage(false));
        return;
      }
      const submitBtn = pwForm.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      try {
        await api('/auth/password', { method: 'POST', body: { mode: 'set', password: val } });
        state.passwordSet = true;
        if (state.profile) state.profile.has_password = true;
        const email = state.profile?.prospect?.email || '';
        showToast(getLang() === 'es'
          ? `Listo — entra con ${email} + tu contraseña.`
          : `Set — sign in with ${email} + your password.`);
        mount(renderPage(false));
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = t('profile.save');
        pwErr.textContent = getLang() === 'es' ? 'No se pudo guardar. Intenta de nuevo.' : 'Failed to save. Try again.';
        pwErr.style.display = 'block';
      }
    });
  }

  // Regenerate summary
  const regenBtn = root.querySelector('#btn-regen');
  if (regenBtn) {
    regenBtn.addEventListener('click', async () => {
      if (state.isDemo) { showToast('Demo mode — changes not saved'); return; }
      regenBtn.textContent = 'Generating…';
      regenBtn.disabled = true;
      try {
        await api('/profile', { method: 'PATCH', body: { action: 'regenerate_summary' } });
        // Re-fetch profile to get updated summary
        const fresh = await api(`/profile?token=${encodeURIComponent(getToken())}`);
        state.profile = fresh;
        mount(renderPage());
        showToast('Summary regenerated.');
      } catch {
        regenBtn.textContent = t('profile.regenerate');
        regenBtn.disabled = false;
        showToast('Failed to regenerate. Try again.', 'error');
      }
    });
  }

  // Section edit toggle (both the header div and the edit button)
  root.querySelectorAll('[data-toggle-section], [data-edit-section]').forEach(el => {
    el.addEventListener('click', e => {
      // Don't bubble from edit button to toggle
      e.stopPropagation();
      const secId = el.dataset.toggleSection || el.dataset.editSection;
      state.expandedSection = state.expandedSection === secId ? null : secId;
      mount(renderPage());
      // If expanded, focus first input
      if (state.expandedSection === secId) {
        setTimeout(() => {
          const form = document.querySelector(`[data-section-form="${secId}"]`);
          if (form) {
            const first = form.querySelector('input,select,textarea');
            if (first) first.focus();
          }
        }, 50);
      }
    });
    // Keyboard support on the header div
    if (el.hasAttribute('data-toggle-section')) {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });
    }
  });

  // Section cancel
  root.querySelectorAll('[data-cancel-section]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      state.expandedSection = null;
      mount(renderPage());
    });
  });

  // Section form submit (edit answers)
  root.querySelectorAll('[data-section-form]').forEach(form => {
    const secId = form.dataset.sectionForm;

    // Chip toggle inside section form
    form.querySelectorAll('[data-hours]').forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.dataset.hours;
        form.querySelectorAll('[data-hours]').forEach(c => {
          c.classList.toggle('disc-chip--active', c === chip);
          c.setAttribute('aria-pressed', String(c === chip));
        });
        const hidden = form.querySelector('[name="Q4.hours_range"]');
        if (hidden) hidden.value = val;
      });
    });

    form.querySelectorAll('[data-tool]').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('disc-chip--active');
        chip.setAttribute('aria-pressed', String(chip.classList.contains('disc-chip--active')));
        const activeTool = [...form.querySelectorAll('[data-tool].disc-chip--active')]
          .map(c => c.dataset.tool);
        const hidden = form.querySelector('[name="Q5.tools"]');
        if (hidden) hidden.value = activeTool.join(',');
      });
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (state.isDemo) {
        showToast('Demo mode — changes not saved');
        state.expandedSection = null;
        mount(renderPage());
        return;
      }
      const sec = SECTIONS.find(s => s.id === secId);
      if (!sec) return;
      const newAnswers = sec.collectAnswers(form);
      const submitBtn = form.querySelector('[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      try {
        // PATCH each answer sequentially (backend contract)
        for (const ans of newAnswers) {
          if (ans.value_text !== undefined || ans.value_json !== undefined) {
            await api('/profile', { method: 'PATCH', body: ans });
          }
        }
        // Merge answers into local state
        newAnswers.forEach(na => {
          const idx = state.profile.answers.findIndex(a => a.question_id === na.question_id);
          if (idx >= 0) state.profile.answers[idx] = { ...state.profile.answers[idx], ...na };
          else state.profile.answers.push(na);
        });
        state.expandedSection = null;
        mount(renderPage());
        showToast('Saved.');
      } catch {
        submitBtn.disabled = false;
        submitBtn.textContent = t('profile.save');
        showToast('Failed to save. Try again.', 'error');
      }
    });
  });
}

// ─── TOKEN HELPERS ────────────────────────────────────────────────────────────
function getToken() {
  const sp = new URLSearchParams(location.search);
  if (sp.has('token')) return sp.get('token');
  // Path pattern: /discovery/p/:token
  const m = location.pathname.match(/\/discovery\/p\/([^/?#]+)/);
  return m ? m[1] : '';
}

function isDemoMode() {
  const sp = new URLSearchParams(location.search);
  if (sp.get('demo') === '1' || sp.get('internal') === '1') return true;
  const token = getToken();
  return token === 'demo';
}

// ─── DEMO CARD STATE LOGIC ────────────────────────────────────────────────────
function demoState(prospect) {
  if (isDemoMode()) return { state: 'locked', reviewable: true };
  if (!prospect.calendly_url) return { state: 'locked', reviewable: false };
  const callAt = parseCalendlyDate(prospect.calendly_url);
  if (!callAt) return { state: 'locked', reviewable: false };
  const callMs = callAt.getTime();
  const now = Date.now();
  const expiresAt = callMs + 12 * 60 * 60 * 1000;
  if (now < callMs) return { state: 'locked', reviewable: false };
  if (now < expiresAt) return { state: 'live', reviewable: true, expiresAt };
  return { state: 'expired', reviewable: false };
}

// ─── RENDER: DEMO CARD ────────────────────────────────────────────────────────
function renderDemoCard(prospect) {
  const token = esc(prospect.magic_token || getToken());
  const demoHref = `/discovery/p/${token}/demo`;
  const reviewHref = `/discovery/p/${token}/demo?internal=1`;
  const { state: ds, reviewable, expiresAt } = demoState(prospect);

  if (ds === 'locked') {
    return `
      <div class="disc-demo-card disc-demo-card--locked" aria-label="Tailored demo — coming soon">
        <p class="disc-demo-card__eyebrow">${esc(t('demo.locked.eyebrow'))}</p>
        <div class="disc-demo-card__thumb" aria-hidden="true">
          <div class="disc-demo-card__thumb-kpis">
            <span></span><span></span><span></span>
          </div>
          <div class="disc-demo-card__lock-overlay">
            <div class="disc-demo-card__lock-label">${esc(t('demo.locked.title'))}</div>
            <div class="disc-demo-card__lock-sub">${esc(t('demo.locked.sub'))}</div>
          </div>
        </div>
        ${reviewable
          ? `<button type="button" class="disc-demo-card__review-link"
               data-demo-review-href="${reviewHref}"
               aria-label="Review demo as Rafael">
               ${esc(t('demo.locked.review_link'))}
             </button>`
          : ''}
      </div>
    `;
  }

  if (ds === 'live') {
    const msLeft = expiresAt - Date.now();
    const hLeft = Math.floor(msLeft / 3_600_000);
    const mLeft = Math.floor((msLeft % 3_600_000) / 60_000);
    const countdown = t('demo.live.countdown', { h: hLeft, m: mLeft });
    return `
      <div class="disc-demo-card disc-demo-card--live" aria-label="Your tailored demo is live">
        <p class="disc-demo-card__eyebrow">${esc(t('demo.live.eyebrow'))}</p>
        <div class="disc-demo-card__thumb" aria-hidden="true">
          <div class="disc-demo-card__thumb-kpis">
            <span></span><span></span><span></span>
          </div>
        </div>
        <a class="disc-btn disc-btn--primary disc-demo-card__cta"
           href="${demoHref}">
          ${esc(t('demo.live.cta'))}
        </a>
        <p class="disc-demo-card__countdown">${esc(countdown)}</p>
      </div>
    `;
  }

  // expired
  return `
    <div class="disc-demo-card disc-demo-card--expired" aria-label="Demo access expired">
      <p class="disc-demo-card__eyebrow">${esc(t('demo.expired.eyebrow'))}</p>
      <p class="disc-demo-card__msg">${esc(t('demo.expired.msg'))}</p>
      <a class="disc-demo-card__contact" href="mailto:hello@arqentia.com">
        ${esc(t('demo.expired.contact'))}
      </a>
    </div>
  `;
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  state.isDemo = isDemoMode();

  // Restore tab from URL
  const sp = new URLSearchParams(location.search);
  if (sp.get('tab') === 'next') state.activeTab = 'next';

  // Demo mode: skip API, render immediately
  if (state.isDemo) {
    state.profile = DEMO_PROFILE;
    state.loading = false;
    state.error = null;
    mount(renderPage());
    return;
  }

  const token = getToken();
  if (!token) {
    state.error = { type: 'not_found' };
    state.loading = false;
    mount(renderError('not_found'));
    return;
  }

  let data;
  try {
    data = await api(`/profile?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('[profile] API fetch failed:', err);
    state.loading = false;
    state.error = (err.status === 404 || err.status === 401)
      ? { type: 'not_found' }
      : { type: 'network' };
    mount(renderError(state.error.type));
    return;
  }

  state.profile = data;
  state.loading = false;
  state.error = null;
  try {
    mount(renderPage());
  } catch (err) {
    // Render-time crashes used to be silently caught and re-shown as
    // "NETWORK ERROR" — making client-side bugs look like backend outages.
    // Surface to console so the real stack is visible.
    console.error('[profile] render failed:', err);
    throw err;
  }
}

// ─── LANG CHANGE LISTENER ────────────────────────────────────────────────────
document.addEventListener('arq:lang', () => {
  if (state.profile) mount(renderPage());
});

// ─── BOOT ─────────────────────────────────────────────────────────────────────
init();
