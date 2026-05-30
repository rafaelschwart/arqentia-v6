// api/_lib/email.js
import { Resend } from 'resend';

let _resend;
function resend() {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('Missing RESEND_API_KEY');
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM = () => process.env.RESEND_FROM_EMAIL || 'hello@arqentia.com';
const FALLBACK_FROM = 'onboarding@resend.dev'; // Resend-owned, always sendable
const SITE = () => process.env.PUBLIC_SITE_URL || 'https://arqentia-v4-review.vercel.app';

// Wraps resend.emails.send so a failure caused by an unverified domain in the
// FROM address transparently retries with onboarding@resend.dev. Lets you
// switch RESEND_FROM_EMAIL to hello@arqentia.com BEFORE the domain is verified
// in Resend's dashboard — sends keep working from the fallback address until
// verification completes.
async function sendWithFallback(payload) {
  try {
    const r = await resend().emails.send(payload);
    if (r?.error) throw new Error(typeof r.error === 'string' ? r.error : (r.error.message || JSON.stringify(r.error)));
    console.log(`[email] sent OK: id=${r?.data?.id || '?'} from=${payload.from} to=${payload.to} subject="${payload.subject}"`);
    return r;
  } catch (e) {
    const msg = String(e?.message || e || '').toLowerCase();
    const isDomainErr = /domain|verif|sender|not_authorized|from\b/.test(msg);
    if (!isDomainErr || payload.from === FALLBACK_FROM) {
      console.error(`[email] send FAILED: from=${payload.from} to=${payload.to} err=${e?.message || e}`);
      throw e;
    }
    console.warn(`[email] FROM=${payload.from} rejected (${msg.slice(0, 90)}). Retrying with ${FALLBACK_FROM}.`);
    try {
      const r2 = await resend().emails.send({ ...payload, from: FALLBACK_FROM });
      if (r2?.error) throw new Error(typeof r2.error === 'string' ? r2.error : (r2.error.message || JSON.stringify(r2.error)));
      console.log(`[email] fallback sent OK: id=${r2?.data?.id || '?'} from=${FALLBACK_FROM} to=${payload.to}`);
      return r2;
    } catch (e2) {
      console.error(`[email] fallback ALSO failed: from=${FALLBACK_FROM} to=${payload.to} err=${e2?.message || e2}`);
      throw e2;
    }
  }
}

export async function sendMagicLink({ to, name, magic_token, language = 'en' }) {
  const url = `${SITE()}/discovery/p/${magic_token}`;
  const subject = language === 'es' ? 'Tu perfil de Arqentia está listo' : 'Your Arqentia profile is ready';
  const html = language === 'es' ? esMagicLink({ name, url }) : enMagicLink({ name, url });
  return sendWithFallback({ from: FROM(), to, subject, html });
}

export async function notifyRafael({ prospect, summary, suggested_template_url }) {
  const subject = `New discovery · ${prospect.name || 'Anonymous'} · ${prospect.company || '?'} · ${(prospect.sector_id || 'UNCLASSIFIED').toUpperCase()}`;
  const profileUrl = `${SITE()}/discovery/p/${prospect.magic_token}`;
  // `?internal=1` keeps demo-preview.js from bouncing admin to the prospect's
  // profile when the arq_admin cookie isn't present (e.g. clicking from a
  // fresh inbox window where you haven't logged into admin yet).
  const demoUrl    = `${SITE()}/discovery/p/${prospect.magic_token}/demo?internal=1`;
  const adminUrl   = `${SITE()}/arqentia/admin#prospect=${prospect.id}`;
  const html = rafaelNotifyTpl({ prospect, summary, profileUrl, demoUrl, adminUrl, suggested_template_url });
  return sendWithFallback({
    from: FROM(),
    to: process.env.RAFAEL_NOTIFY_EMAIL,
    subject,
    html
  });
}

// Generic exported send for admin magic-link auth (Track D3)
// `code` is a self-contained signed token (see api/admin/magic.js)
export async function sendAdminMagicLink({ code, expiresAtIso }) {
  const to = 'hello@arqentia.com';
  const url = `${SITE()}/api/admin/magic?token=${encodeURIComponent(code)}`;
  const subject = `Arqentia admin sign-in link`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#0B1220;">
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#475569;">// Arqentia admin</div>
      <h1 style="font-size:20px;margin:18px 0 12px;font-weight:600;">Sign in to the admin console</h1>
      <p style="font-size:14px;line-height:1.5;color:#475569;margin:0 0 20px;">Click the button below to open the admin. Link expires at ${esc(expiresAtIso)}.</p>
      <p style="margin:24px 0;"><a href="${url}" style="background:#0B1220;color:#F8FAFC;padding:12px 22px;text-decoration:none;font-weight:500;">Open admin →</a></p>
      <p style="font-size:11px;color:#94A3B8;word-break:break-all;">Or paste this URL: ${esc(url)}</p>
      <p style="font-size:12px;color:#94A3B8;margin-top:16px;">If you didn't request this, ignore the email. The link expires automatically.</p>
    </div>`;
  return sendWithFallback({ from: FROM(), to, subject, html });
}

// ─── Templates ───────────────────────────────────────────────────────────

function enMagicLink({ name, url }) {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:540px;margin:0 auto;padding:32px;color:#0B1220;">
    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#475569;">// Arqentia · Discovery</div>
    <h1 style="font-size:24px;margin:18px 0 12px;font-weight:600;">Hi ${esc(name)},</h1>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">Your discovery profile is saved. Open it any time to review or update your answers:</p>
    <p style="margin:24px 0;"><a href="${url}" style="background:#0B1220;color:#F8FAFC;padding:12px 22px;text-decoration:none;font-weight:500;">Open my profile →</a></p>
    <p style="font-size:13px;color:#475569;line-height:1.5;">If you didn't request this, you can ignore this email — the link expires in 90 days.</p>
  </div>`;
}

function esMagicLink({ name, url }) {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:540px;margin:0 auto;padding:32px;color:#0B1220;">
    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#475569;">// Arqentia · Discovery</div>
    <h1 style="font-size:24px;margin:18px 0 12px;font-weight:600;">Hola ${esc(name)},</h1>
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">Tu perfil de descubrimiento está guardado. Ábrelo cuando quieras para revisar o actualizar tus respuestas:</p>
    <p style="margin:24px 0;"><a href="${url}" style="background:#0B1220;color:#F8FAFC;padding:12px 22px;text-decoration:none;font-weight:500;">Abrir mi perfil →</a></p>
    <p style="font-size:13px;color:#475569;line-height:1.5;">Si no solicitaste esto, puedes ignorar este email — el enlace expira en 90 días.</p>
  </div>`;
}

function rafaelNotifyTpl({ prospect, summary, profileUrl, demoUrl, adminUrl, suggested_template_url }) {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0B1220;">
    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#475569;">// New discovery</div>
    <h1 style="font-size:22px;margin:12px 0;">${esc(prospect.name || 'Anonymous')} · ${esc(prospect.company || '—')}</h1>
    <p style="font-size:13px;color:#475569;margin:0;">${esc(prospect.role || '—')} · ${esc(prospect.country || '—')} · ${esc(prospect.phone || '—')} · ${esc(prospect.email || '—')}</p>
    <h2 style="font-size:14px;margin:24px 0 8px;font-family:'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#475569;">// AI Summary</h2>
    <div style="font-size:14px;line-height:1.55;border-left:3px solid #2563EB;padding-left:14px;">${summary?.summary_text || ''}</div>
    <h2 style="font-size:14px;margin:24px 0 8px;font-family:'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#475569;">// Key</h2>
    <table style="font-size:13px;border-collapse:collapse;width:100%;">
      <tr><td style="padding:4px 8px;color:#475569;width:160px;">Sector</td><td style="padding:4px 8px;font-weight:500;">${esc(summary?.sector_classification || '—')}</td></tr>
      <tr><td style="padding:4px 8px;color:#475569;">Capability</td><td style="padding:4px 8px;font-weight:500;">${esc(summary?.suggested_capability || '—')}</td></tr>
      <tr><td style="padding:4px 8px;color:#475569;">Est. hrs/week saved</td><td style="padding:4px 8px;font-weight:500;">${esc(String(summary?.est_hours_saved ?? '—'))}</td></tr>
    </table>
    <div style="margin:28px 0;display:flex;gap:8px;flex-wrap:wrap;">
      <a href="${demoUrl}" style="background:#2563EB;color:#fff;padding:10px 18px;text-decoration:none;font-weight:500;">View personalized demo →</a>
      <a href="${adminUrl}" style="background:#0B1220;color:#F8FAFC;padding:10px 18px;text-decoration:none;font-weight:500;">Open in admin</a>
      <a href="${profileUrl}" style="background:transparent;color:#0B1220;border:1px solid #CBD5E1;padding:9px 17px;text-decoration:none;font-weight:500;">Prospect's view</a>
    </div>
    <p style="font-size:11px;color:#94A3B8;margin:16px 0 0;font-family:'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase;">// Demo · ${esc(demoUrl)}</p>
  </div>`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
