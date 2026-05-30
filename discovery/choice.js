// discovery/choice.js
// Renders the /discovery path-choice screen (voice vs. form).
// All copy is sourced from i18n.js — no hardcoded strings.

import { getLang, setLang, t } from './i18n.js';
import { animate, stagger } from './vendor/anime.esm.js';

// ─── REDUCED MOTION ──────────────────────────────────────────────────────────
const RM = window.matchMedia('(prefers-reduced-motion: reduce)');

// Guard: only run entrance on FIRST render. Lang toggles re-render without
// retriggering the entrance so the user doesn't see the animation reset.
let _hasAnimatedIn = false;

// ─── RENDER ──────────────────────────────────────────────────────────────────

function renderChoice() {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = `
    <main class="disc-choice" id="choice-main">
      <div class="disc-choice__top-row">
        <p class="disc-choice__eyebrow">${t('choice.eyebrow')}</p>
        <div class="disc-langtoggle disc-langtoggle--on-dark" role="group" aria-label="Language">
          <button
            class="disc-langtoggle__btn${getLang() === 'en' ? ' disc-langtoggle__btn--active' : ''}"
            data-lang="en"
            aria-pressed="${getLang() === 'en'}"
          >EN</button>
          <span class="disc-langtoggle__sep" aria-hidden="true">/</span>
          <button
            class="disc-langtoggle__btn${getLang() === 'es' ? ' disc-langtoggle__btn--active' : ''}"
            data-lang="es"
            aria-pressed="${getLang() === 'es'}"
          >ES</button>
        </div>
      </div>

      <div class="disc-choice__hero">
        <h1 class="disc-choice__heading">
          ${t('choice.heading.before')}<em>${t('choice.heading.em')}</em>${t('choice.heading.after')}
        </h1>
        <p class="disc-choice__subline">${t('choice.subline')}</p>
      </div>

      <div class="disc-choice__cards" role="list">

        <!-- Card 1: Voice (primary) -->
        <article class="disc-choice__card disc-choice__card--primary" role="listitem">
          <div class="disc-choice__card-header">
            <p class="disc-choice__card-eyebrow">${t('choice.voice.eyebrow')}</p>
            <div class="disc-choice__icon" aria-hidden="true">
              <div class="disc-choice__icon-bars">
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
          <h2 class="disc-choice__card-title">${t('choice.voice.title')}</h2>
          <p class="disc-choice__card-body">${t('choice.voice.body')}</p>
          <p class="disc-choice__card-help">${t('choice.voice.help')}</p>
          <a href="/discovery/voice" class="disc-btn disc-btn--primary disc-choice__cta">
            ${t('choice.voice.cta')}
          </a>
        </article>

        <!-- Card 2: Form (secondary) -->
        <article class="disc-choice__card disc-choice__card--secondary" role="listitem">
          <div class="disc-choice__card-header">
            <p class="disc-choice__card-eyebrow">${t('choice.form.eyebrow')}</p>
          </div>
          <h2 class="disc-choice__card-title">${t('choice.form.title')}</h2>
          <p class="disc-choice__card-body">${t('choice.form.body')}</p>
          <p class="disc-choice__card-help">${t('choice.form.help')}</p>
          <a href="/discovery/text" class="disc-btn disc-btn--ghost-dark disc-choice__cta">
            ${t('choice.form.cta')}
          </a>
        </article>

      </div>

      <footer class="disc-choice__footer">
        <p class="disc-choice__signin">
          ${t('choice.signin_prompt')} <a href="/discovery/login" class="disc-choice__signin-link">${t('choice.signin_link')}</a>
        </p>
      </footer>
    </main>
  `;

  bindLangToggle(root);

  // ─── ENTRANCE ANIMATION ────────────────────────────────────────────────────
  // Only fire once per page-load. Lang-toggle re-renders skip this entirely —
  // elements are already visible so we just leave them in their final state.
  if (!_hasAnimatedIn) {
    _hasAnimatedIn = true;
    if (!RM.matches) {
      requestAnimationFrame(() => {
        animate('.disc-choice__eyebrow', {
          opacity: [0, 1],
          translateY: [12, 0],
          duration: 420,
          ease: 'outCubic'
        });
        animate('.disc-choice__heading', {
          opacity: [0, 1],
          translateY: [16, 0],
          duration: 560,
          delay: 100,
          ease: 'outCubic'
        });
        animate('.disc-choice__subline', {
          opacity: [0, 1],
          translateY: [12, 0],
          duration: 480,
          delay: 220,
          ease: 'outCubic'
        });
        animate('.disc-choice__card', {
          opacity: [0, 1],
          translateY: [24, 0],
          duration: 640,
          delay: stagger(120, { start: 320 }),
          ease: 'outQuart'
        });
        animate('.disc-choice__footer', {
          opacity: [0, 1],
          duration: 400,
          delay: 800,
          ease: 'outCubic'
        });
      });
    }
  }
}

// ─── LANGUAGE TOGGLE ─────────────────────────────────────────────────────────

function bindLangToggle(root) {
  root.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      renderChoice();
    });
  });
}

// ─── BOOT ────────────────────────────────────────────────────────────────────

renderChoice();

// Re-render if lang changes from another source (e.g. a different tab)
document.addEventListener('arq:lang', () => renderChoice());
