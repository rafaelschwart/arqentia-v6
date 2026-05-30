// discovery/voice.js
// Arqentia Discovery — Voice interview surface.
// Ethos-style AI conversation: waveform field, live transcript, call controls.
// State machine: intro → connecting → listening ↔ speaking ↔ thinking → ended → building → redirect.

import { animate, createTimeline, stagger } from './vendor/anime.esm.js';
import { getLang, setLang, t } from './i18n.js';
import { api } from './api.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const BAR_COUNT = 16;
const REDIRECT_DEMO = '/discovery/p/demo?demo=1';

// ─── DEMO SCRIPT ──────────────────────────────────────────────────────────────

const DEMO_SCRIPT = [
  { role: 'agent', text: "Hi Mariana, thanks for joining. To start: what kind of business do you run?", pause: 4000 },
  { role: 'user',  text: "We're a distribution company in Lima. About 80 employees, we deliver consumer goods to 380 bodegas.", pause: 2000 },
  { role: 'agent', text: "Got it. What's the most painful manual process you run every week?", pause: 5000 },
  { role: 'user',  text: "Sales reconciliation. We have four spreadsheets that don't talk to each other, and we close the week manually.", pause: 2500 },
  { role: 'agent', text: "How many hours does that take you and your team?", pause: 3500 },
  { role: 'user',  text: "About 18 hours a week between me and two staff.", pause: 2500 },
  { role: 'agent', text: "What tools touch this process today?", pause: 4500 },
  { role: 'user',  text: "Excel for the spreadsheets, SAP Business One as our ERP, and WhatsApp for daily updates from the field.", pause: 2500 },
  { role: 'agent', text: "If we could fix one thing in the next ninety days, what would have the biggest impact?", pause: 5000 },
  { role: 'user',  text: "Getting our weekly close from three days down to four hours — with real-time KPIs.", pause: 2500 },
  { role: 'agent', text: "Last one — who else needs to be in the room for this decision?", pause: 4000 },
  { role: 'user',  text: "Me and our CFO.", pause: 2000 },
  { role: 'agent', text: "Perfect. I have everything I need. We'll put together a tailored profile and your discovery call slot. Talk soon.", pause: 4500 }
];

// ─── INLINE SVG ICONS (Lucide-style, 24×24, stroke 1.6, currentColor) ────────

const ICON_MIC = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
  <rect x="9" y="2" width="6" height="12" rx="0"/>
  <path d="M5 10v2a7 7 0 0 0 14 0v-2"/>
  <line x1="12" y1="19" x2="12" y2="22"/>
  <line x1="8" y1="22" x2="16" y2="22"/>
</svg>`;

const ICON_MIC_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
  <line x1="2" y1="2" x2="22" y2="22"/>
  <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/>
  <path d="M5 10v2a7 7 0 0 0 9.9 6.43"/>
  <path d="M15 9.34V4a3 3 0 0 0-5.68-1.33"/>
  <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
  <line x1="12" y1="19" x2="12" y2="22"/>
  <line x1="8" y1="22" x2="16" y2="22"/>
</svg>`;

const ICON_TRANSCRIPT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
</svg>`;

const ICON_PHONE_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 3.07 8.63 19.79 19.79 0 0 1 0 0"/>
  <line x1="23" y1="1" x2="1" y2="23"/>
</svg>`;

const ICON_X = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

// ─── STATE ────────────────────────────────────────────────────────────────────

const state = {
  phase: 'intro',        // 'intro' | 'briefing' | 'connecting' | 'listening' | 'speaking' | 'thinking' | 'ended' | 'building'
  is_demo: false,
  muted: false,
  show_transcript: false,
  transcript: [],
  transcript_pending: { agent: '', user: '' },
  elapsed_sec: 0,
  language: getLang(),
  // Live mode WebRTC
  pc: null,
  dc: null,
  micStream: null,
  prospect_id: null,
  prospect_token: null,
  // Demo internals
  _demo_idx: 0,
  _demo_timers: [],
  _bar_animations: [],
  _ring_animation: null,
  _dot_animation: null,
  _sonar_interval: null,
  _timer_interval: null,
  _start_ts: null,
  // Auto-end countdown — set when agent says the END SIGNAL phrase
  _autoEndTimer: null,
  _autoEndRemaining: 0
};

// ─── REDUCED MOTION ───────────────────────────────────────────────────────────

const RM = window.matchMedia('(prefers-reduced-motion: reduce)');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmt_time(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function q_label(idx) {
  const total = DEMO_SCRIPT.filter(s => s.role === 'agent').length;
  const done = DEMO_SCRIPT.slice(0, idx + 1).filter(s => s.role === 'agent').length;
  return `Q${done} of ${total}`;
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function render() {
  const root = document.getElementById('root');
  if (!root) return;

  const is_demo = state.is_demo;
  const lang = state.language;

  root.innerHTML = `
    <main class="disc-voice" id="voice-main" aria-label="Voice interview">

      ${is_demo ? `
        <a href="${REDIRECT_DEMO}" class="disc-voice__skip-demo" id="skip-demo">
          ${t('voice.skip_demo')}
        </a>
        <div class="disc-voice__demo-badge" aria-label="Demo mode indicator">
          ${t('voice.demo_badge')}
        </div>
      ` : ''}

      <!-- INTRO SCREEN -->
      <section
        class="disc-voice__intro${state.phase !== 'intro' ? ' disc-voice__intro--hidden' : ''}"
        id="voice-intro"
        aria-hidden="${state.phase !== 'intro'}"
      >
        <div class="disc-voice__intro-top">
          <p class="disc-voice__intro-eyebrow">${t('voice.intro.eyebrow')}</p>
          <div class="disc-langtoggle disc-langtoggle--on-dark" role="group" aria-label="Language">
            <button
              class="disc-langtoggle__btn${lang === 'en' ? ' disc-langtoggle__btn--active' : ''}"
              data-lang="en"
              aria-pressed="${lang === 'en'}"
            >EN</button>
            <span class="disc-langtoggle__sep" aria-hidden="true">/</span>
            <button
              class="disc-langtoggle__btn${lang === 'es' ? ' disc-langtoggle__btn--active' : ''}"
              data-lang="es"
              aria-pressed="${lang === 'es'}"
            >ES</button>
          </div>
        </div>

        <div class="disc-voice__intro-hero">
          <h1 class="disc-voice__intro-heading">
            ${t('voice.intro.heading.before')}<em>${t('voice.intro.heading.em')}</em>${t('voice.intro.heading.after')}
          </h1>
          <p class="disc-voice__intro-sub">${t('voice.intro.sub')}</p>
        </div>

        <p class="disc-voice__intro-helper">${t('voice.intro.mic_required')}</p>

        <button
          class="disc-btn disc-btn--primary disc-voice__intro-cta"
          id="voice-start"
          type="button"
          aria-label="${t('voice.intro.start')}"
        >
          ${t('voice.intro.start')}
        </button>
        <p class="disc-voice__intro-fallback">
          <a href="/discovery/text">${t('voice.intro.or_type')}</a>
        </p>

        <p class="disc-voice__intro-privacy">${t('voice.intro.privacy')}</p>
      </section>

      <!-- BRIEFING SCREEN (between intro and connecting) -->
      <section
        class="disc-voice__brief${state.phase !== 'briefing' ? ' disc-voice__brief--hidden' : ''}"
        id="voice-brief"
        aria-hidden="${state.phase !== 'briefing'}"
        aria-label="Pre-call briefing"
      >
        <div class="disc-voice__brief-top">
          <p class="disc-voice__brief-eyebrow">${t('voice.brief.eyebrow')}</p>
          <button type="button" class="disc-voice__brief-back" id="voice-brief-back" aria-label="${t('voice.brief.back')}">
            ${t('voice.brief.back')}
          </button>
        </div>

        <div class="disc-voice__brief-hero">
          <h1 class="disc-voice__brief-heading">${t('voice.brief.heading')}</h1>
          <p class="disc-voice__brief-sub">${t('voice.brief.sub')}</p>
        </div>

        <ol class="disc-voice__brief-tips" aria-label="Call tips">
          <li class="disc-voice__brief-tip">
            <span class="disc-voice__brief-tip-num" aria-hidden="true">01</span>
            <div>
              <p class="disc-voice__brief-tip-title">${t('voice.brief.tip1.title')}</p>
              <p class="disc-voice__brief-tip-body">${t('voice.brief.tip1.body')}</p>
            </div>
          </li>
          <li class="disc-voice__brief-tip">
            <span class="disc-voice__brief-tip-num" aria-hidden="true">02</span>
            <div>
              <p class="disc-voice__brief-tip-title">${t('voice.brief.tip2.title')}</p>
              <p class="disc-voice__brief-tip-body">${t('voice.brief.tip2.body')}</p>
            </div>
          </li>
          <li class="disc-voice__brief-tip">
            <span class="disc-voice__brief-tip-num" aria-hidden="true">03</span>
            <div>
              <p class="disc-voice__brief-tip-title">${t('voice.brief.tip3.title')}</p>
              <p class="disc-voice__brief-tip-body">${t('voice.brief.tip3.body')}</p>
            </div>
          </li>
          <li class="disc-voice__brief-tip">
            <span class="disc-voice__brief-tip-num" aria-hidden="true">04</span>
            <div>
              <p class="disc-voice__brief-tip-title">${t('voice.brief.tip4.title')}</p>
              <p class="disc-voice__brief-tip-body">${t('voice.brief.tip4.body')}</p>
            </div>
          </li>
        </ol>

        <div class="disc-voice__brief-check" aria-label="${t('voice.brief.checklist_title')}">
          <p class="disc-voice__brief-check-title">${t('voice.brief.checklist_title')}</p>
          <ul class="disc-voice__brief-check-list">
            <li>${t('voice.brief.check1')}</li>
            <li>${t('voice.brief.check2')}</li>
            <li>${t('voice.brief.check3')}</li>
          </ul>
        </div>

        <button
          class="disc-btn disc-btn--primary disc-voice__brief-cta"
          id="voice-brief-begin"
          type="button"
        >
          ${t('voice.brief.begin')}
        </button>
      </section>

      <!-- CALL SCREEN (all phases except intro + briefing + building) -->
      <section
        class="disc-voice__call${state.phase === 'intro' || state.phase === 'briefing' || state.phase === 'building' ? ' disc-voice__call--hidden' : ''}"
        id="voice-call"
        aria-hidden="${state.phase === 'intro' || state.phase === 'briefing' || state.phase === 'building'}"
        aria-label="Active voice call"
      >
        <!-- Left column: waveform + status + controls -->
        <div class="disc-voice__call-left">
          <!-- Waveform field -->
          <div class="disc-voice__field" id="voice-field" aria-hidden="true">
            <div class="disc-voice__field-bg"></div>
            <div class="disc-voice__ring" id="voice-ring"></div>
            <div class="disc-voice__bars" id="voice-bars">
              ${Array.from({ length: BAR_COUNT }, (_, i) =>
                `<div class="disc-voice__bar" id="vbar-${i}" style="transform-origin: center bottom;"></div>`
              ).join('')}
            </div>
            <!-- Three-dot thinking loader inside field (shown only on 'thinking') -->
            <div class="dot-loader disc-voice__thinking-dots${state.phase !== 'thinking' ? ' dot-loader--hidden' : ''}" id="thinking-dots" aria-hidden="true">
              <span></span><span></span><span></span>
            </div>
          </div>

          <!-- Status area -->
          <div class="disc-voice__status-area" aria-live="polite" aria-atomic="true">
            <div class="disc-voice__status-row">
              <span class="disc-voice__status" id="voice-status">
                ${getStatusText()}
              </span>
              <span class="disc-voice__status-dot${state.phase === 'listening' || state.phase === 'speaking' ? ' disc-voice__status-dot--active' : ''}" id="status-dot" aria-hidden="true"></span>
            </div>
            <p class="disc-voice__progress" id="voice-progress" aria-label="Question progress"></p>
          </div>

          <!-- Timer -->
          <p class="disc-voice__timer" id="voice-timer" aria-label="Call duration">${fmt_time(state.elapsed_sec)}</p>

          <!-- Controls bar -->
          <div class="disc-voice__controls" role="toolbar" aria-label="Call controls">
            <button
              class="disc-voice__control${state.muted ? ' disc-voice__control--muted' : ''}"
              id="ctrl-mic"
              type="button"
              aria-label="${state.muted ? t('voice.controls.mic_off') : t('voice.controls.mic_on')}"
              aria-pressed="${state.muted}"
              ${state.phase === 'connecting' ? 'disabled' : ''}
            >
              ${state.muted ? ICON_MIC_OFF : ICON_MIC}
              <span class="disc-voice__control-label">${state.muted ? t('voice.controls.mic_off') : t('voice.controls.mic_on')}</span>
            </button>

            <button
              class="disc-voice__control disc-voice__control--end"
              id="ctrl-end"
              type="button"
              aria-label="${t('voice.controls.end_call')}"
              ${state.phase === 'connecting' ? 'disabled' : ''}
            >
              ${ICON_PHONE_DOWN}
              <span class="disc-voice__control-label">${t('voice.controls.end_call')}</span>
            </button>
          </div>

          <!-- Error banner (mic denied / network error) -->
          <div class="disc-voice__error-banner" id="voice-error-banner" hidden>
            <p class="disc-voice__error-banner-msg" id="voice-error-msg"></p>
            <a href="?demo=1" class="disc-voice__error-try-demo" id="voice-error-demo">${t('voice.error.try_demo')}</a>
          </div>

          <!-- Ended overlay -->
          ${state.phase === 'ended' ? `
            <div class="disc-voice__ended" id="voice-ended" aria-live="polite">
              <p class="disc-voice__ended-status">${t('voice.status.ended')}</p>
            </div>
          ` : ''}
        </div>

        <!-- Right column: always-visible transcript panel -->
        <aside
          class="disc-voice__transcript-panel"
          id="transcript-panel"
          aria-label="Live transcript"
          role="log"
          aria-live="polite"
        >
          <p class="disc-voice__transcript-eyebrow">${t('voice.transcript_panel.eyebrow')}</p>
          <p class="disc-voice__transcript-sub">${t('voice.transcript_panel.sub')}</p>
          <div class="disc-voice__transcript-list" id="transcript-list">
            ${renderTranscriptPanel()}
          </div>
        </aside>
      </section>

      <!-- BUILDING SCREEN -->
      <section
        class="disc-voice__building${state.phase !== 'building' ? ' disc-voice__building--hidden' : ''}"
        id="voice-building"
        aria-hidden="${state.phase !== 'building'}"
        aria-live="polite"
      >
        <p class="disc-voice__building-eyebrow">${t('voice.building.eyebrow')}</p>
        <p class="disc-voice__building-status">${t('voice.status.building')}</p>
        <p class="disc-voice__building-sub">${t('voice.building.sub')}</p>
        <div class="dot-loader dot-loader--large" aria-label="Loading" role="status">
          <span></span><span></span><span></span><span></span>
        </div>
        <ul class="disc-voice__building-steps" aria-label="Build progress">
          <li>${t('voice.building.step1')}</li>
          <li>${t('voice.building.step2')}</li>
          <li>${t('voice.building.step3')}</li>
        </ul>
        <p class="disc-voice__building-redirect">${t('voice.building.redirect')}</p>
      </section>

    </main>
  `;

  bind_events();

  if (state.phase !== 'intro' && state.phase !== 'building') {
    init_waveform_for_phase(state.phase);
  }

  if (state.show_transcript) {
    scroll_transcript_to_bottom();
  }
}

// ─── TRANSCRIPT RENDERING ─────────────────────────────────────────────────────

function renderTranscriptItems() {
  if (state.transcript.length === 0) return '';
  return state.transcript.map(turn => {
    const label = turn.role === 'agent'
      ? t('voice.transcript.agent_label')
      : t('voice.transcript.user_label');
    const ts = fmt_time(Math.round((turn.ts - state._start_ts) / 1000));
    return `
      <div class="disc-voice__transcript-turn disc-voice__transcript-turn--${turn.role}">
        <p class="disc-voice__transcript-meta">// ${label}  ·  ${ts}</p>
        <p class="disc-voice__transcript-text">${turn.text}</p>
      </div>
    `;
  }).join('');
}

function renderTranscriptPanel() {
  const has_pending_agent = !!state.transcript_pending.agent;
  const has_pending_user  = !!state.transcript_pending.user;
  const has_content = state.transcript.length > 0 || has_pending_agent || has_pending_user;

  if (!has_content) {
    return `<p class="disc-voice__transcript-empty" aria-live="polite">${t('voice.transcript_panel.empty')}</p>`;
  }

  const turns_html = state.transcript.map(turn => {
    const label = turn.role === 'agent'
      ? t('voice.transcript.agent_label')
      : t('voice.transcript.user_label');
    const ts = state._start_ts
      ? fmt_time(Math.round((turn.ts - state._start_ts) / 1000))
      : '00:00';
    return `
      <div class="disc-voice__transcript-turn disc-voice__transcript-turn--${turn.role}">
        <p class="disc-voice__transcript-meta">// ${label}  ·  ${ts}</p>
        <p class="disc-voice__transcript-text">${turn.text}</p>
      </div>
    `;
  }).join('');

  // Streaming chunk at bottom — only one at a time (agent or user)
  let streaming_html = '';
  if (has_pending_agent) {
    streaming_html = `
      <div class="disc-voice__transcript-turn disc-voice__transcript-turn--agent disc-voice__transcript-chunk--streaming">
        <p class="disc-voice__transcript-meta">// ${t('voice.transcript.agent_label')}  ·  ${fmt_time(state.elapsed_sec)}</p>
        <p class="disc-voice__transcript-text">${state.transcript_pending.agent}<span class="disc-voice__blink-cursor" aria-hidden="true">&#9607;</span></p>
      </div>
    `;
  } else if (has_pending_user) {
    streaming_html = `
      <div class="disc-voice__transcript-turn disc-voice__transcript-turn--user disc-voice__transcript-chunk--streaming">
        <p class="disc-voice__transcript-meta">// ${t('voice.transcript.user_label')}  ·  ${fmt_time(state.elapsed_sec)}</p>
        <p class="disc-voice__transcript-text">${state.transcript_pending.user}<span class="disc-voice__blink-cursor" aria-hidden="true">&#9607;</span></p>
      </div>
    `;
  }

  return turns_html + streaming_html;
}

// ─── STATUS TEXT HELPER ───────────────────────────────────────────────────────

function getStatusText() {
  switch (state.phase) {
    case 'connecting': return t('voice.status.connecting');
    case 'listening':  return t('voice.status.listening');
    case 'speaking':   return t('voice.status.speaking');
    case 'thinking':   return t('voice.status.thinking');
    case 'ended':      return t('voice.status.ended');
    default:           return '';
  }
}

// ─── PATCH DOM (no full re-render for state changes during call) ───────────────

function patch_status() {
  const el = document.getElementById('voice-status');
  const dot = document.getElementById('status-dot');
  const dots = document.getElementById('thinking-dots');
  if (el) el.textContent = getStatusText();
  if (dot) {
    const active = state.phase === 'listening' || state.phase === 'speaking';
    dot.classList.toggle('disc-voice__status-dot--active', active);
  }
  if (dots) {
    const thinking = state.phase === 'thinking';
    dots.classList.toggle('dot-loader--hidden', !thinking);
    if (thinking && !RM.matches) animate_thinking_dots();
  }
}

function patch_controls() {
  const mic = document.getElementById('ctrl-mic');
  const end = document.getElementById('ctrl-end');
  const disabled = state.phase === 'connecting' || state.phase === 'ended';

  if (mic) {
    mic.disabled = disabled;
    mic.setAttribute('aria-pressed', String(state.muted));
    mic.setAttribute('aria-label', state.muted ? t('voice.controls.mic_off') : t('voice.controls.mic_on'));
    mic.innerHTML = (state.muted ? ICON_MIC_OFF : ICON_MIC)
      + `<span class="disc-voice__control-label">${state.muted ? t('voice.controls.mic_off') : t('voice.controls.mic_on')}</span>`;
    mic.classList.toggle('disc-voice__control--muted', state.muted);
  }
  if (end) {
    end.disabled = disabled;
  }
}

function patch_timer() {
  const el = document.getElementById('voice-timer');
  if (el) el.textContent = fmt_time(state.elapsed_sec);
}

function scroll_transcript_to_bottom() {
  const list = document.getElementById('transcript-list');
  if (list) list.scrollTop = list.scrollHeight;
}

function update_transcript_panel() {
  const list = document.getElementById('transcript-list');
  if (!list) return;
  list.innerHTML = renderTranscriptPanel();
  scroll_transcript_to_bottom();
}

// Kept for compat with demo runner (push_transcript_turn calls it)
function update_transcript_list() {
  update_transcript_panel();
}

function showErrorBanner(msg) {
  const banner = document.getElementById('voice-error-banner');
  const msg_el = document.getElementById('voice-error-msg');
  if (!banner || !msg_el) return;
  msg_el.textContent = msg;
  banner.hidden = false;
}

function hideErrorBanner() {
  const banner = document.getElementById('voice-error-banner');
  if (banner) banner.hidden = true;
}

// ─── WAVEFORM ANIMATIONS ──────────────────────────────────────────────────────

function stop_bar_animations() {
  state._bar_animations.forEach(a => { try { a.pause(); } catch (e) {} });
  state._bar_animations = [];
  if (state._ring_animation) {
    try { state._ring_animation.pause(); } catch (e) {}
    state._ring_animation = null;
  }
  if (state._sonar_interval) {
    clearInterval(state._sonar_interval);
    state._sonar_interval = null;
  }
}

function get_bars() {
  return Array.from({ length: BAR_COUNT }, (_, i) => document.getElementById(`vbar-${i}`)).filter(Boolean);
}

function set_bars_static(scale) {
  get_bars().forEach(bar => {
    bar.style.transform = `scaleY(${scale})`;
  });
}

function animate_bars_listening() {
  if (RM.matches) { set_bars_static(0.45); return; }
  stop_bar_animations();
  const bars = get_bars();
  bars.forEach((bar, i) => {
    const wave_offset = Math.sin((i / BAR_COUNT) * Math.PI) * 0.2;
    const anim = animate(bar, {
      scaleY: [
        { to: 0.28 + wave_offset },
        { to: 0.52 + wave_offset },
        { to: 0.34 + wave_offset },
        { to: 0.58 + wave_offset },
        { to: 0.30 + wave_offset }
      ],
      duration: 1800 + i * 60,
      ease: 'inOutSine',
      loop: true,
      delay: i * 40
    });
    state._bar_animations.push(anim);
  });
}

function animate_bars_speaking() {
  if (RM.matches) { set_bars_static(0.6); return; }
  stop_bar_animations();
  const bars = get_bars();
  bars.forEach((bar, i) => {
    const anim = animate(bar, {
      scaleY: [
        { to: 0.4 + Math.random() * 0.2 },
        { to: 0.65 + Math.random() * 0.35 },
        { to: 0.3 + Math.random() * 0.25 },
        { to: 0.8 + Math.random() * 0.2 },
        { to: 0.5 + Math.random() * 0.4 }
      ],
      duration: 1200 + Math.random() * 400,
      ease: 'inOutSine',
      loop: true,
      delay: i * 35
    });
    state._bar_animations.push(anim);
  });
  start_sonar_ring();
}

function animate_bars_connecting() {
  if (RM.matches) { set_bars_static(0.15); return; }
  stop_bar_animations();
  const bars = get_bars();
  bars.forEach((bar, i) => {
    const anim = animate(bar, {
      scaleY: [{ to: 0.12 }, { to: 0.22 }, { to: 0.10 }],
      duration: 2400,
      ease: 'inOutSine',
      loop: true,
      delay: i * 60
    });
    state._bar_animations.push(anim);
  });
}

function animate_bars_dim() {
  if (RM.matches) { set_bars_static(0.12); return; }
  stop_bar_animations();
  const bars = get_bars();
  bars.forEach((bar, i) => {
    const anim = animate(bar, {
      scaleY: [{ to: 0.10 }, { to: 0.18 }, { to: 0.08 }],
      duration: 3200,
      ease: 'inOutSine',
      loop: true,
      delay: i * 80
    });
    state._bar_animations.push(anim);
  });
}

function start_sonar_ring() {
  if (RM.matches) return;
  const ring = document.getElementById('voice-ring');
  if (!ring) return;

  function ping() {
    const r = document.getElementById('voice-ring');
    if (!r || state.phase !== 'speaking') return;
    animate(r, {
      scale: [1, 1.72],
      opacity: [0.55, 0],
      duration: 1600,
      ease: 'outQuad'
    });
  }

  ping();
  state._sonar_interval = setInterval(ping, 1650);
}

function animate_thinking_dots() {
  if (RM.matches) return;
  const dots = document.querySelectorAll('.disc-voice__thinking-dots span');
  if (!dots.length) return;
  if (state._dot_animation) {
    try { state._dot_animation.pause(); } catch (e) {}
  }
  state._dot_animation = animate(dots, {
    opacity: [0.2, 1],
    scale: [1, 1.25],
    duration: 600,
    loop: true,
    alternate: true,
    delay: stagger(180)
  });
}

function init_waveform_for_phase(phase) {
  switch (phase) {
    case 'connecting': animate_bars_connecting(); break;
    case 'listening':  animate_bars_listening();  break;
    case 'speaking':   animate_bars_speaking();   break;
    case 'thinking':   animate_bars_dim(); animate_thinking_dots(); break;
    case 'ended':      stop_bar_animations(); set_bars_static(0.1); break;
    default:           break;
  }
}

// ─── PHASE TRANSITIONS ────────────────────────────────────────────────────────

function transition_to(next_phase) {
  const prev = state.phase;
  state.phase = next_phase;

  // Show/hide main call section without full re-render
  const call_section = document.getElementById('voice-call');
  const intro_section = document.getElementById('voice-intro');
  const brief_section = document.getElementById('voice-brief');
  const building_section = document.getElementById('voice-building');

  if (next_phase === 'intro') {
    // Back button on briefing — full re-render for clean state
    render();
    return;
  }

  // Briefing: slide in between intro and call. Handled by full re-render
  // (markup is conditional on phase, so render() picks it up cleanly).
  if (next_phase === 'briefing') {
    render();
    if (!RM.matches) {
      const el = document.getElementById('voice-brief');
      if (el) animate(el, { opacity: [0, 1], translateY: [16, 0], duration: 400, ease: 'outQuart' });
    }
    return;
  }

  if (next_phase === 'building') {
    if (call_section) { call_section.classList.add('disc-voice__call--hidden'); call_section.setAttribute('aria-hidden', 'true'); }
    if (intro_section) { intro_section.classList.add('disc-voice__intro--hidden'); intro_section.setAttribute('aria-hidden', 'true'); }
    if (building_section) { building_section.classList.remove('disc-voice__building--hidden'); building_section.setAttribute('aria-hidden', 'false'); }
    animate_building_dots();
    // Demo mode always redirects to demo. Live mode redirect is handled by endLiveCall.
    if (state.is_demo) {
      setTimeout(() => { window.location.href = REDIRECT_DEMO; }, 1800);
    }
    return;
  }

  // Reveal call screen if transitioning from intro or briefing
  if (prev === 'intro' || prev === 'briefing') {
    if (intro_section) { intro_section.classList.add('disc-voice__intro--hidden'); intro_section.setAttribute('aria-hidden', 'true'); }
    if (brief_section) { brief_section.classList.add('disc-voice__brief--hidden'); brief_section.setAttribute('aria-hidden', 'true'); }
    if (call_section) { call_section.classList.remove('disc-voice__call--hidden'); call_section.setAttribute('aria-hidden', 'false'); }
    if (!RM.matches) {
      animate(call_section, { opacity: [0, 1], translateY: [16, 0], duration: 400, ease: 'outQuart' });
    }
  }

  patch_status();
  patch_controls();
  init_waveform_for_phase(next_phase);

  // Handle ended phase
  if (next_phase === 'ended') {
    stop_bar_animations();
    stop_timer();

    const left_col = document.querySelector('.disc-voice__call-left');
    const existing_ended = document.getElementById('voice-ended');
    if (!existing_ended && left_col) {
      const ended_div = document.createElement('div');
      ended_div.className = 'disc-voice__ended';
      ended_div.id = 'voice-ended';
      ended_div.setAttribute('aria-live', 'polite');
      ended_div.innerHTML = `<p class="disc-voice__ended-status">${t('voice.status.ended')}</p>`;
      left_col.appendChild(ended_div);
      if (!RM.matches) {
        animate(ended_div, { opacity: [0, 1], duration: 400, ease: 'outQuart' });
      }
    }

    setTimeout(() => { transition_to('building'); }, 1200);
  }
}

function animate_building_dots() {
  if (RM.matches) return;
  const dots = document.querySelectorAll('.dot-loader--large span');
  if (!dots.length) return;
  animate(dots, {
    opacity: [0.2, 1],
    scale: [0.8, 1.2],
    duration: 500,
    loop: true,
    alternate: true,
    delay: stagger(140)
  });

  // Heading soft pulse (breathing effect while profile is being built)
  const heading = document.querySelector('.disc-voice__building-status');
  if (heading) {
    animate(heading, {
      opacity:  [0.6, 1],
      duration: 1400,
      ease: 'inOutSine',
      loop: true,
      alternate: true
    });
  }
}

// ─── TIMER ────────────────────────────────────────────────────────────────────

function start_timer() {
  state._start_ts = Date.now();
  state.elapsed_sec = 0;
  state._timer_interval = setInterval(() => {
    state.elapsed_sec++;
    patch_timer();
  }, 1000);
}

function stop_timer() {
  if (state._timer_interval) {
    clearInterval(state._timer_interval);
    state._timer_interval = null;
  }
}

// ─── LIVE MODE · OpenAI Realtime WebRTC ───────────────────────────────────────

async function startLiveCall() {
  hideErrorBanner();

  // FILL mode: user came from their profile (Track A5 voice-fill). We don't
  // create a new prospect — we reuse the existing one identified by ?fill=<token>.
  // The fill-session endpoint returns a scoped agent prompt. Optional
  // ?section=<id> scopes the agent to a single section's questions.
  const params = new URLSearchParams(window.location.search);
  const fillToken = params.get('fill');
  const fillSection = params.get('section');
  state.fillMode = !!fillToken;
  if (state.fillMode) {
    state.prospect_token = fillToken;
    state.fillSection = fillSection || null;
    // Skip prospect creation — we're filling, not starting fresh
  } else {
    // 1. Create anonymous prospect so we have an identity to attach the transcript to.
    try {
      const startResp = await api('/start', { method: 'POST', body: { language: getLang() } });
      state.prospect_id    = startResp.prospect_id || null;
      state.prospect_token = startResp.magic_token  || null;
    } catch (err) {
      console.warn('[voice] /start failed, proceeding without prospect identity:', err.message);
    }
  }

  // 2. Get ephemeral key — fill mode uses scoped fill-session endpoint
  let sess;
  try {
    const sessionUrl = state.fillMode ? '/voice/fill-session' : '/voice/session';
    const sessionBody = state.fillMode
      ? { language: getLang(), token: fillToken, section: state.fillSection || undefined }
      : { language: getLang() };
    sess = await api(sessionUrl, { method: 'POST', body: sessionBody });
  } catch (err) {
    console.error('[voice] session endpoint failed:', err.status, err.message);
    if (err.status === 429) {
      showErrorBanner(getLang() === 'es'
        ? 'Has usado tus 3 intentos en las últimas 6h. Vuelve más tarde o escribe los datos en tu perfil.'
        : 'You\'ve used your 3 voice-fill attempts in the last 6h. Come back later or type the info on your profile.');
    } else {
      showErrorBanner(t('voice.error.connect_failed'));
    }
    setPhase('error');
    return;
  }

  // 3. Create peer connection
  const pc = new RTCPeerConnection();
  state.pc = pc;

  // 4. Receive remote audio → play in <audio>
  const audioEl = document.createElement('audio');
  audioEl.autoplay = true;
  audioEl.id = 'arq-agent-audio';
  audioEl.setAttribute('playsinline', 'true');
  document.body.appendChild(audioEl);
  pc.ontrack = (e) => {
    console.log('[voice] pc.ontrack fired, streams:', e.streams?.length, 'kind:', e.track?.kind);
    audioEl.srcObject = e.streams[0];
    // Explicit .play() in case autoplay is blocked despite the user-gesture.
    // We catch silently — if it rejects, the next user interaction will resume it.
    audioEl.play().then(() => {
      console.log('[voice] agent audio playback started');
    }).catch(err => {
      console.warn('[voice] audio .play() rejected (autoplay blocked?):', err.message);
    });
  };

  // 5. Capture mic, add track
  let micStream;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    setPhase('error');
    showErrorBanner(t('voice.error.mic_denied'));
    pc.close();
    state.pc = null;
    return;
  }
  state.micStream = micStream;
  micStream.getAudioTracks().forEach(t => pc.addTrack(t, micStream));

  // 6. Open data channel for events (transcript, function calls, etc)
  const dc = pc.createDataChannel('oai-events');
  state.dc = dc;
  dc.addEventListener('open', () => {
    console.log('[voice] data channel open — sending response.create to trigger greet');
    try {
      dc.send(JSON.stringify({ type: 'response.create' }));
      setPhase('speaking');
    } catch (err) {
      console.error('[voice] failed to trigger initial greet:', err);
    }
  });
  dc.addEventListener('message', (e) => {
    try {
      const ev = JSON.parse(e.data);
      // Log every event type so we can see if response.* events fire at all.
      console.log('[voice] dc event:', ev.type, ev.code || '');
      handleRealtimeEvent(ev);
    } catch {}
  });

  // 7. SDP offer → POST to OpenAI realtime calls endpoint
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  let r;
  try {
    r = await fetch(
      `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(sess.model)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sess.client_secret}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      }
    );
  } catch (fetchErr) {
    console.error('[voice] SDP fetch failed:', fetchErr);
    setPhase('error');
    showErrorBanner(t('voice.error.connect_failed'));
    _teardown_live_resources();
    return;
  }

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    console.error('[voice] SDP exchange failed:', r.status);
    setPhase('error');
    showErrorBanner(t('voice.error.connect_failed'));
    _teardown_live_resources();
    return;
  }

  const answerSdp = await r.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  // Now connected — agent will greet, server VAD handles turn-taking.
  state._start_ts = Date.now();
  setPhase('listening');
  startCallTimer();
}

function handleRealtimeEvent(ev) {
  switch (ev.type) {
    case 'response.audio_transcript.delta':
      appendAgentTranscriptChunk(ev.delta || '');
      setPhase('speaking');
      break;
    case 'response.audio_transcript.done':
      finalizeAgentTurn(ev.transcript || '');
      break;
    case 'conversation.item.input_audio_transcription.delta':
      appendUserTranscriptChunk(ev.delta || '');
      setPhase('listening');
      break;
    case 'conversation.item.input_audio_transcription.completed':
      finalizeUserTurn(ev.transcript || '');
      setPhase('thinking');
      break;
    case 'input_audio_buffer.speech_started':
      setPhase('listening');
      break;
    case 'input_audio_buffer.speech_stopped':
      setPhase('thinking');
      break;
    case 'response.done':
      setPhase('listening');
      break;
    case 'error':
      console.error('[realtime] error event:', ev.code, ev.message);
      break;
  }
}

async function endLiveCall() {
  _teardown_live_resources();

  // Show the building screen BEFORE the long-running API call. /voice/end-call
  // takes ~25-30s server-side (parse transcript → write answers → write summary →
  // notify Rafael → generate demo). Without this, the user stares at a frozen
  // call screen the entire time wondering if anything is happening.
  setPhase('building');

  try {
    await api('/voice/end-call', {
      method: 'POST',
      body: {
        transcript: state.transcript,
        duration_sec: state.elapsed_sec
      }
    });
  } catch (err) {
    console.error('[voice] end-call POST failed:', err.message);
    // Even if the API errors, still redirect — partial data is better than a stuck page
  }

  // Prospect always goes to their PROFILE dashboard, never to the personalized
  // demo. Demo is admin-only (review tool, not a prospect deliverable).
  // Fallback if somehow we don't have a token: send them to the discovery
  // landing page rather than the static demo fixture.
  const redirect = state.prospect_token
    ? `/discovery/p/${state.prospect_token}`
    : '/discovery';
  setTimeout(() => { location.href = redirect; }, 600);
}

function _teardown_live_resources() {
  cancelAutoEndCountdown();
  try { state.dc?.close(); } catch {}
  try {
    state.pc?.getSenders().forEach(s => { try { s.track?.stop(); } catch {} });
    state.pc?.close();
  } catch {}
  try { state.micStream?.getTracks().forEach(t => t.stop()); } catch {}
  const audioEl = document.getElementById('arq-agent-audio');
  if (audioEl) audioEl.remove();
  state.pc = null;
  state.dc = null;
  state.micStream = null;
}

// Transcript chunk helpers — live mode
function appendAgentTranscriptChunk(text) {
  state.transcript_pending.agent = (state.transcript_pending.agent || '') + text;
  update_transcript_panel();
}

// Phrases the agent says when it's finished collecting answers. Matches the
// END SIGNAL contract in api/_lib/openai.js system prompt. When detected,
// we start a 10-second countdown then auto-end the call so the user doesn't
// have to click anything.
const END_SIGNAL_PHRASES = [
  // English
  "perfect, i have everything i need",
  "i have everything i need",
  "i've got everything i need",
  "we're all set",
  "your profile is complete",
  // Spanish
  "perfecto, tengo todo lo que necesito",
  "tengo todo lo que necesito",
  "tu perfil está completo",
  "perfil completo",
  "tu dashboard estará listo en un momento"
];
function detectEndSignal(text) {
  if (!text) return false;
  const norm = text.toLowerCase().replace(/[¡¿!?.,]/g, '').trim();
  return END_SIGNAL_PHRASES.some(p => norm.includes(p));
}

function finalizeAgentTurn(fullText) {
  const text = fullText || state.transcript_pending.agent;
  if (text) {
    state.transcript.push({ role: 'agent', text, ts: Date.now() });
  }
  state.transcript_pending.agent = '';
  update_transcript_panel();

  // End-of-interview detection — start auto-end countdown if not already running
  if (text && !state._autoEndTimer && detectEndSignal(text)) {
    startAutoEndCountdown(10);
  }
}

// Visible 10-second countdown banner with a Cancel button so the prospect can
// abort if they have one more thing to say.
function startAutoEndCountdown(seconds = 10) {
  if (state._autoEndTimer) return;
  state._autoEndRemaining = seconds;
  renderAutoEndBanner();
  state._autoEndTimer = setInterval(() => {
    state._autoEndRemaining -= 1;
    if (state._autoEndRemaining <= 0) {
      cancelAutoEndCountdown();
      endLiveCall();
    } else {
      renderAutoEndBanner();
    }
  }, 1000);
}
function cancelAutoEndCountdown() {
  if (state._autoEndTimer) {
    clearInterval(state._autoEndTimer);
    state._autoEndTimer = null;
  }
  state._autoEndRemaining = 0;
  const el = document.getElementById('voice-auto-end');
  if (el) el.remove();
}
function renderAutoEndBanner() {
  let el = document.getElementById('voice-auto-end');
  const lang = state.language === 'es' ? 'es' : 'en';
  const msg = lang === 'es'
    ? `Llamada terminando en ${state._autoEndRemaining}s…`
    : `Call ending in ${state._autoEndRemaining}s…`;
  const cancelLabel = lang === 'es' ? 'Cancelar' : 'Cancel';
  if (!el) {
    el = document.createElement('div');
    el.id = 'voice-auto-end';
    el.className = 'disc-voice__auto-end';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <span class="disc-voice__auto-end-msg">${msg}</span>
    <button type="button" class="disc-voice__auto-end-cancel" id="voice-auto-end-cancel">${cancelLabel}</button>
  `;
  const btn = document.getElementById('voice-auto-end-cancel');
  if (btn) btn.addEventListener('click', cancelAutoEndCountdown);
}

function appendUserTranscriptChunk(text) {
  state.transcript_pending.user = (state.transcript_pending.user || '') + text;
  update_transcript_panel();
}

function finalizeUserTurn(fullText) {
  const text = fullText || state.transcript_pending.user;
  if (text) {
    state.transcript.push({ role: 'user', text, ts: Date.now() });
  }
  state.transcript_pending.user = '';
  update_transcript_panel();
}

// setPhase is the public alias for transition_to (called from handleRealtimeEvent)
function setPhase(next) {
  transition_to(next);
}

// startCallTimer is the public alias for start_timer (called from startLiveCall)
function startCallTimer() {
  start_timer();
}

// ─── DEMO RUNNER ──────────────────────────────────────────────────────────────

function run_demo() {
  let idx = 0;
  state._start_ts = Date.now();
  start_timer();

  function next_turn() {
    if (idx >= DEMO_SCRIPT.length) {
      transition_to('ended');
      return;
    }

    const turn = DEMO_SCRIPT[idx];
    const turn_idx = idx;
    idx++;

    if (turn.role === 'agent') {
      transition_to('speaking');
      // Typewrite the agent text into transcript progressively
      push_transcript_turn_live(turn, turn_idx, () => {
        // After agent finishes speaking, short thinking gap then user
        const t1 = setTimeout(() => {
          transition_to('thinking');
          const t2 = setTimeout(() => {
            next_turn();
          }, 800);
          state._demo_timers.push(t2);
        }, turn.pause);
        state._demo_timers.push(t1);
      });
    } else {
      // User turn — listening state, then "respond"
      transition_to('listening');
      const t1 = setTimeout(() => {
        push_transcript_turn(turn);
        next_turn();
      }, turn.pause);
      state._demo_timers.push(t1);
    }

    // Update question progress
    const progress_el = document.getElementById('voice-progress');
    if (progress_el) {
      const agent_turn_count = DEMO_SCRIPT.slice(0, turn_idx + 1).filter(s => s.role === 'agent').length;
      const total_agent = DEMO_SCRIPT.filter(s => s.role === 'agent').length;
      if (turn.role === 'agent') {
        progress_el.textContent = `Q${agent_turn_count} of ${total_agent}`;
      }
    }
  }

  next_turn();
}

function push_transcript_turn(turn) {
  state.transcript.push({ ...turn, ts: Date.now() });
  update_transcript_list();
}

function push_transcript_turn_live(turn, idx, on_done) {
  // Adds the turn to transcript, simulating typewriter via char-by-char
  const entry = { role: turn.role, text: '', ts: Date.now() };
  state.transcript.push(entry);

  const full_text = turn.text;
  const char_delay = Math.min(28, (turn.pause * 0.55) / full_text.length);
  let char_idx = 0;

  const entry_ref = state.transcript[state.transcript.length - 1];

  function type_next() {
    if (char_idx >= full_text.length) {
      on_done();
      return;
    }
    entry_ref.text = full_text.slice(0, char_idx + 1);
    char_idx++;
    update_transcript_list();
    const tid = setTimeout(type_next, char_delay);
    state._demo_timers.push(tid);
  }

  type_next();
}

function stop_demo() {
  state._demo_timers.forEach(t => clearTimeout(t));
  state._demo_timers = [];
  stop_bar_animations();
  stop_timer();
}

// ─── EVENT BINDING ────────────────────────────────────────────────────────────

function bind_events() {
  // Start button (intro → briefing)
  const start_btn = document.getElementById('voice-start');
  if (start_btn) {
    start_btn.addEventListener('click', on_start);
  }

  // Briefing buttons (briefing → intro | briefing → connecting)
  const brief_back = document.getElementById('voice-brief-back');
  if (brief_back) brief_back.addEventListener('click', on_brief_back);
  const brief_begin = document.getElementById('voice-brief-begin');
  if (brief_begin) brief_begin.addEventListener('click', on_brief_begin);

  // Language toggle — guard against double-bind on re-render. The header
  // toggle in voice.html lives outside #root and would otherwise pick up a
  // new click listener on every render().
  document.querySelectorAll('[data-lang]').forEach(btn => {
    if (btn.dataset.langBound === '1') return;
    btn.dataset.langBound = '1';
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      setLang(lang);
      state.language = lang;
      // Reflect the active state on the header toggle if it's present.
      document.querySelectorAll('.disc-langtoggle--header [data-lang]').forEach(b => {
        b.classList.toggle('is-active', b.getAttribute('data-lang') === lang);
      });
      render();
    });
  });
  // Initial active state on the header toggle.
  document.querySelectorAll('.disc-langtoggle--header [data-lang]').forEach(b => {
    b.classList.toggle('is-active', b.getAttribute('data-lang') === state.language);
  });

  // Mic toggle — also mutes/unmutes the live mic track
  const mic_btn = document.getElementById('ctrl-mic');
  if (mic_btn) {
    mic_btn.addEventListener('click', () => {
      state.muted = !state.muted;
      if (state.micStream) {
        state.micStream.getAudioTracks().forEach(track => {
          track.enabled = !state.muted;
        });
      }
      patch_controls();
    });
  }

  // End call
  const end_btn = document.getElementById('ctrl-end');
  if (end_btn) {
    end_btn.addEventListener('click', on_end_call);
  }

  // Skip demo
  const skip = document.getElementById('skip-demo');
  if (skip) {
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      stop_demo();
      transition_to('building');
    });
  }

  // ESC closes transcript drawer
  document.addEventListener('keydown', on_keydown);
}

function on_keydown(e) {
  // Reserved for future keyboard shortcuts
  void e;
}

function on_start() {
  // First go to the briefing screen — gives the user mute-discipline + what-to-expect
  // before the mic permission prompt and the live agent.
  transition_to('briefing');
}

function on_brief_back() {
  transition_to('intro');
}

function on_brief_begin() {
  transition_to('connecting');

  if (state.is_demo) {
    const connect_delay = RM.matches ? 400 : 1600;
    if (!RM.matches) animate_connecting_dots();
    setTimeout(() => { run_demo(); }, connect_delay);
  } else {
    // Brief connecting beat then kick off the live WebRTC flow
    const connect_delay = RM.matches ? 200 : 800;
    if (!RM.matches) animate_connecting_dots();
    setTimeout(() => { startLiveCall(); }, connect_delay);
  }
}

function animate_connecting_dots() {
  // Three-dot animation on status text for connecting phase
  // The dots are in the status text via CSS ::after content trick —
  // we animate them via a separate element if present
  const dots = document.querySelectorAll('#connecting-dots span');
  if (!dots.length) return;
  animate(dots, {
    opacity: [0.2, 1],
    scale: [1, 1.15],
    duration: 500,
    loop: true,
    alternate: true,
    delay: stagger(160)
  });
}

function on_end_call() {
  if (state.is_demo) {
    stop_demo();
    transition_to('ended');
  } else {
    stop_timer();
    stop_bar_animations();
    endLiveCall();
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

function init() {
  const params = new URLSearchParams(window.location.search);
  state.is_demo = params.get('demo') === '1';
  state.language = getLang();
  const fillToken = params.get('fill'); // Track A5: came from profile to fill missing fields

  // Apply lang attribute
  document.documentElement.setAttribute('lang', state.language);

  // Fill mode: skip intro + briefing, auto-jump into the call
  if (fillToken) {
    state.phase = 'connecting';
    render();
    // Brief connecting beat then kick off the live WebRTC flow
    setTimeout(() => { startLiveCall(); }, RM.matches ? 200 : 800);
  } else {
    render();

    // Entrance animation for intro screen
    if (state.phase === 'intro' && !RM.matches) {
      const intro = document.getElementById('voice-intro');
      if (intro) {
        animate(intro, { opacity: [0, 1], translateY: [20, 0], duration: 480, ease: 'outQuart' });
      }
    }
  }

  // Lang change event from other parts of the system
  document.addEventListener('arq:lang', (e) => {
    state.language = e.detail;
    render();
  });

  // Release mic + close WebRTC on page unload
  window.addEventListener('beforeunload', () => {
    if (!state.is_demo) {
      _teardown_live_resources();
    }
  });
}

init();
