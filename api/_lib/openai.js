// api/_lib/openai.js
// OpenAI client utility — issues ephemeral tokens for Realtime API and
// runs text-completion calls (for non-realtime tasks).

let _client = null;
function client() {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const e = new Error('Missing OPENAI_API_KEY');
    e.code = 'ENV_MISSING';
    throw e;
  }
  _client = key; // we use plain fetch — no SDK dep
  return _client;
}

// GA Realtime API (replaces the deprecated Beta /v1/realtime/sessions shape).
// Docs: https://platform.openai.com/docs/guides/realtime
const REALTIME_MODEL = 'gpt-realtime';                // GA model. Use 'gpt-realtime-mini' for cheaper.
const REALTIME_VOICE = 'alloy';                       // alloy | echo | shimmer | nova | sage | verse | marin | cedar
const REALTIME_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

/**
 * Request an ephemeral client_secret from OpenAI's GA Realtime API so the
 * browser can connect directly to /v1/realtime/calls via WebRTC without
 * exposing the server-side API key.
 *
 * Returns: { value, expires_at, session }
 *   - value:      the ephemeral secret to pass as Bearer when the browser
 *                 POSTs its SDP offer to /v1/realtime/calls?model=<model>
 *   - expires_at: unix seconds
 *   - session:    echoed session config
 */
export async function createRealtimeEphemeralKey({ language = 'en', instructions = null } = {}) {
  const key = client();
  const sysPrompt = instructions || defaultInstructions(language);

  // GA shape — everything goes under `session.*`. Audio modality split into
  // `audio.input` and `audio.output`, voice lives on audio.output.voice,
  // turn detection moves to audio.input.turn_detection, transcription lives
  // at audio.input.transcription.
  const r = await fetch(REALTIME_CLIENT_SECRETS_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions: sysPrompt,
        audio: {
          input: {
            // gpt-4o-mini-transcribe handles Spanish accents + industry
            // proper nouns ("bodega", "SAP Business One", WhatsApp) noticeably
            // better than whisper-1, which matters for the Lima/Florida market.
            transcription: { model: 'gpt-4o-mini-transcribe' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700
            }
          },
          output: {
            voice: REALTIME_VOICE
          }
        }
      }
    })
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error(`OpenAI realtime session ${r.status}: ${err}`);
  }
  return r.json();
}

export const REALTIME_MODEL_NAME = REALTIME_MODEL;

function defaultInstructions(language) {
  const lang = language === 'es' ? 'Spanish' : 'English';
  return `You are Arqentia's discovery agent, conducting a 6-minute voice interview with a prospect in ${lang}.

═══════════════════════════════════════════════════════════════════
OPENING SCRIPT — say this EXACTLY at the start of the call, before any questions.
KEEP IT SHORT (under 20 seconds of speech). Real consultants don't read scripts.
═══════════════════════════════════════════════════════════════════

"Hi! I'm Arqentia's discovery agent — we'll cover about 10 short questions in 6 minutes. Quick tip: tap the mic button to MUTE between answers so background noise doesn't cut me off. When we're done I'll say 'Perfect, I have everything I need' and the call wraps automatically — first, can I get your name, work email, and best WhatsApp number?"

That single sentence covers the greeting, the mute hint, the end-signal contract,
and pivots straight into Q0. Do NOT add a second housekeeping item or a "sound
good?" check-in — it burns 15 seconds of a 360-second budget for zero value.

═══════════════════════════════════════════════════════════════════
QUESTION FLOW
═══════════════════════════════════════════════════════════════════

  0. WARM-UP / IDENTITY (FIRST, before Q1) — non-negotiable:
     Ask for THREE things in a single sentence:
       (a) their first name (so you can address them)
       (b) their best work email
       (c) the best phone number (with country code) for WhatsApp follow-up
     If they only give one or two, politely ask for the missing ones.
     Once you have name + email + phone, briefly acknowledge ("Thanks, <name>") and move to Q1.

Then cover these 10 anchor topics in conversation:
  1. What kind of business they run (industry + headcount)
  2. What the company actually does day-to-day (one-line)
  3. The most painful manual process they run weekly
  4. Hours per week that process eats (them + team)
  5. Tools that touch that process (ERP, CRM, Excel, WhatsApp, etc.)
  6. Where the data actually lives (one ERP / multiple systems / spreadsheets / paper)
  7. The ONE thing they'd fix in 90 days for biggest impact
  8. Success in numbers (a metric and a target)
  9. Their role + who else needs to be in the decision
  10. Confirm the phone you captured at the start is OK for WhatsApp + ask Calendly time preference

═══════════════════════════════════════════════════════════════════
RULES OF ENGAGEMENT
═══════════════════════════════════════════════════════════════════

- Be conversational, not robotic. One question at a time. Acknowledge their answer briefly before moving on.
- If their answer is rich, ask ONE smart follow-up before advancing. Don't over-probe.
- If they go off-topic, gently guide back.
- If the line gets noisy or you hear interruptions, gently remind them they can mute between answers.
- Keep the whole conversation under 7 minutes (including warm-up).
- **CRITICAL — END SIGNAL:** After question 10, you MUST say the exact phrase "Perfect, I have everything I need" (or in Spanish: "Perfecto, tengo todo lo que necesito"). This phrase is what triggers the auto-end timer on our side — do NOT paraphrase or omit it. After saying it, you may say one short closing line then stop.
- Do NOT summarize the conversation on the call. The dashboard handles that.
- Speak naturally in ${lang}. Match their formality.`;
}

/**
 * Standard chat completion — used by transcript parsing if we don't want to
 * call Anthropic for everything. Optional; transcript parsing currently uses
 * Anthropic Claude via api/_lib/claude.js.
 */
export async function chatComplete({ system, user, model = 'gpt-4o-mini', maxTokens = 600 }) {
  const key = client();
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user }
      ]
    })
  });
  if (!r.ok) throw new Error(`OpenAI chat ${r.status}: ${await r.text().catch(() => '')}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}
