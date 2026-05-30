// api/_lib/notify.js
import { supabase } from './supabase.js';
import { notifyRafael as emailRafael } from './email.js';
import { createHmac } from 'node:crypto';

export async function notifyAll(prospect, summary) {
  const site = process.env.PUBLIC_SITE_URL;
  const sector = summary?.sector_classification || prospect.sector_id || 'distribucion';
  const suggested = `${site}/_templates/dashboards/${sector}/`;

  await record(prospect.id, 'email', async () =>
    emailRafael({ prospect, summary, suggested_template_url: suggested })
  );

  if (process.env.SLACK_WEBHOOK_URL) {
    await record(prospect.id, 'slack', async () => slack(prospect, summary, suggested, site));
  }
}

async function slack(prospect, summary, suggested_template_url, site) {
  const body = {
    text: `New discovery: ${prospect.name} · ${prospect.company} · ${summary?.sector_classification || '?'}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `${prospect.name || 'Anonymous'} · ${prospect.company || '?'}` } },
      { type: 'section', text: { type: 'mrkdwn', text: summary?.summary_text || '_no summary_' } },
      { type: 'actions', elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Open profile' }, url: `${site}/discovery/p/${prospect.magic_token}` },
        { type: 'button', text: { type: 'plain_text', text: 'Open template' }, url: suggested_template_url }
      ]}
    ]
  };
  const r = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Slack webhook ${r.status}`);
}

async function record(prospect_id, channel, fn) {
  const { data: note } = await supabase.from('notifications').insert({ prospect_id, channel }).select().single();
  try {
    await fn();
    await supabase.from('notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', note.id);
  } catch (e) {
    await supabase.from('notifications').update({ status: 'failed', error: String(e?.message || e) }).eq('id', note.id);
  }
}

export function signMarkCalledUrl(prospectId) {
  const secret = process.env.ARQ_COOKIE_SECRET;
  const sig = createHmac('sha256', secret).update(`mark-called:${prospectId}`).digest('hex').slice(0, 16);
  return `${process.env.PUBLIC_SITE_URL}/api/discovery/mark-called?id=${prospectId}&sig=${sig}`;
}

export function verifyMarkCalledSig(prospectId, sig) {
  const secret = process.env.ARQ_COOKIE_SECRET;
  const expected = createHmac('sha256', secret).update(`mark-called:${prospectId}`).digest('hex').slice(0, 16);
  return sig === expected;
}
