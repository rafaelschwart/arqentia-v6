// discovery/login.js
import { t, getLang, setLang, localize } from './i18n.js';
import { api } from './api.js';
import { animate, stagger } from './vendor/anime.esm.js';

const RM = window.matchMedia('(prefers-reduced-motion: reduce)');

// Entrance fires once. Re-renders (error state, loading state) skip it so the
// panel doesn't flash again mid-interaction.
let _hasAnimatedIn = false;

const state = { mode: 'form', error: null, magicSent: false, loading: false, showPassword: false };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function render() {
  const root = document.getElementById('root');
  const lang = getLang();
  document.documentElement.setAttribute('lang', lang);

  root.innerHTML = `
    <div class="disc-langtoggle" role="group" aria-label="Language">
      <button data-lang="en" class="${lang==='en'?'is-active':''}" aria-pressed="${lang==='en'}">EN</button>
      <span aria-hidden="true">|</span>
      <button data-lang="es" class="${lang==='es'?'is-active':''}" aria-pressed="${lang==='es'}">ES</button>
    </div>
    <div class="disc-login">
      <div class="disc-gate__panel">
        <div class="disc-gate__eyebrow">${esc(t('login.eyebrow'))}</div>
        <h1 class="disc-gate__heading">${esc(t('login.title'))}</h1>
        ${state.magicSent ? `
          <p class="disc-gate__sub">${esc(t('login.magic_sent'))}</p>
        ` : `
          <form class="disc-login-form" id="login-form" novalidate>
            <label class="disc-field">
              <span class="disc-label">${esc(t('login.identifier'))}</span>
              <input class="disc-input" type="text" name="identifier" required autocomplete="username" placeholder="${esc(t('login.identifier_placeholder'))}" />
            </label>
            <label class="disc-field">
              <span class="disc-label">${esc(t('login.password'))}</span>
              <div class="disc-input-wrap">
                <input class="disc-input disc-input--with-toggle" type="${state.showPassword ? 'text' : 'password'}" name="password" required minlength="8" autocomplete="current-password" />
                <button type="button" id="toggle-pw" class="disc-input-toggle" aria-pressed="${state.showPassword}" aria-label="${esc(state.showPassword ? t('login.hide_password') : t('login.show_password'))}" title="${esc(state.showPassword ? t('login.hide_password') : t('login.show_password'))}">
                  ${state.showPassword
                    ? `<svg class="disc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.6 19.6 0 0 1 4.22-5.19"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a19.6 19.6 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`
                    : `<svg class="disc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`
                  }
                </button>
              </div>
            </label>
            ${state.error ? `<div class="disc-error" role="alert">${esc(state.error)}</div>` : ''}
            <div class="disc-card__actions">
              <button type="submit" class="disc-btn disc-btn--primary" ${state.loading ? 'disabled' : ''}>
                ${esc(state.loading ? '…' : t('login.submit'))}
              </button>
            </div>
            <button type="button" class="disc-login-forgot" id="forgot">${esc(t('login.forgot'))}</button>
          </form>
        `}
      </div>
    </div>`;

  // Language toggle
  root.querySelectorAll('.disc-langtoggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      render();
    });
  });

  if (!state.magicSent) {
    document.getElementById('login-form').addEventListener('submit', onSubmit);
    document.getElementById('forgot').addEventListener('click', onForgot);
    const toggle = document.getElementById('toggle-pw');
    if (toggle) toggle.addEventListener('click', onTogglePassword);
  }

  // ─── ENTRANCE ANIMATION (first render only) ───────────────────────────────
  if (!_hasAnimatedIn && !RM.matches) {
    _hasAnimatedIn = true;
    requestAnimationFrame(() => {
      animate('.disc-gate__panel', {
        opacity:    [0, 1],
        translateY: [16, 0],
        duration: 500,
        ease: 'outQuart'
      });
      animate('.disc-gate__panel .disc-field, .disc-gate__panel .disc-error, .disc-gate__panel .disc-card__actions, .disc-login-forgot, .disc-gate__sub', {
        opacity:    [0, 1],
        translateY: [8, 0],
        duration: 320,
        delay: stagger(70, { start: 220 }),
        ease: 'outCubic'
      });
    });
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  // Accept either `identifier` (new label, can be username or email) or
  // legacy `email` if some caller still uses the old form.
  const identifier = String(fd.get('identifier') || fd.get('email') || '').trim();
  const password = String(fd.get('password') || '');
  if (!identifier || password.length < 8) {
    state.error = t('login.invalid');
    return render();
  }
  state.loading = true;
  state.error = null;
  render();
  try {
    // Send BOTH fields so the server can dispatch on either. The endpoint
    // accepts `username` (matched ilike) OR `email` (matched ilike).
    const r = await api('/auth/password', { method: 'POST', body: { mode: 'login', username: identifier, email: identifier, password } });
    state.loading = false;
    // Honor ?next=<path> when present (e.g. they were bounced from /arqentia/admin)
    // — but only allow same-origin relative paths to prevent open-redirect abuse.
    const next = new URLSearchParams(location.search).get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
    // Server returns { role, redirect }. Admin → /arqentia/admin. Prospect → /discovery/p/<token>.
    const dest = safeNext || r.redirect || (r.magic_token ? `/discovery/p/${r.magic_token}` : '/discovery');
    window.location.href = dest;
  } catch (err) {
    state.loading = false;
    state.error = err.status === 401 ? t('login.invalid') : (err.message || t('login.invalid'));
    render();
  }
}

function onTogglePassword() {
  // Preserve what's already typed across the re-render
  const pwInput = document.querySelector('input[name="password"]');
  const idInput = document.querySelector('input[name="identifier"]');
  const pwVal = pwInput?.value || '';
  const idVal = idInput?.value || '';
  state.showPassword = !state.showPassword;
  render();
  const pwAfter = document.querySelector('input[name="password"]');
  const idAfter = document.querySelector('input[name="identifier"]');
  if (pwAfter) {
    pwAfter.value = pwVal;
    // Keep focus + cursor at end so the toggle feels frictionless
    pwAfter.focus();
    const n = pwAfter.value.length;
    try { pwAfter.setSelectionRange(n, n); } catch {}
  }
  if (idAfter) idAfter.value = idVal;
}

async function onForgot() {
  const emailInput = document.querySelector('input[name="email"]');
  const email = String(emailInput?.value || '').trim();
  if (!email) {
    state.error = t('login.email') + ' — required';
    return render();
  }
  state.loading = true;
  state.error = null;
  render();
  try {
    await api('/auth/resend-magic', { method: 'POST', body: { email } });
  } catch {}
  state.loading = false;
  state.magicSent = true;
  render();
}

document.addEventListener('arq:lang', render);
render();
