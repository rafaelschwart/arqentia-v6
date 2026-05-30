// api/_lib/demo-fixture.js
// Hardcoded Mariana fixture for token=demo (no Supabase row needed).
// Shared between api/discovery/demo.js and api/discovery/demo/regenerate.js.

export const MARIANA_FIXTURE = {
  prospect: {
    id: 'demo-uuid',
    name: 'Mariana Reyes',
    email: 'mariana@distribuidoraandina.com',
    company: 'Distribuidora Andina',
    role: 'coo',
    sector_id: 'distribucion',
    language: 'en',
    magic_token: 'demo'
  },
  answers: [
    { question_id: 'Q1',   value_json: { industry: 'distribucion', headcount: '51-200' } },
    { question_id: 'Q2',   value_text: 'We distribute consumer goods to 380 bodegas in Lima from a single warehouse — daily routes, weekly invoicing.' },
    { question_id: 'Q3',   value_text: 'Reconciling sales across 4 spreadsheets', value_json: { chips: ['reconciling'] } },
    { question_id: 'Q3.1', value_text: 'Me and two staff' },
    { question_id: 'Q4',   value_json: { hours_range: '10-20' } },
    { question_id: 'Q5',   value_json: { tools: ['excel', 'erp', 'whatsapp'], erp_name: 'SAP Business One' } },
    { question_id: 'Q6',   value_json: { data_state: 'systems_disconnected' } },
    { question_id: 'Q6.1', value_text: 'Our ERP and our shipping system' },
    { question_id: 'Q7',   value_text: 'Real-time KPIs', value_json: { chips: ['kpis'] } },
    { question_id: 'Q7.1', value_text: 'Weekly close time from 3 days to 4 hours' },
    { question_id: 'Q8',   value_json: { metric: 'weekly close time', target: '3 days → 4 hours' } },
    { question_id: 'Q9',   value_json: { role: 'coo', decision_unit: 'finance' } },
    { question_id: 'Q10',  value_json: { phone: '+51 999 999 999', whatsapp_ok: true } }
  ],
  summary: {
    summary_text: 'Mariana runs ops at a mid-size distribución company in Lima. Her biggest weekly bottleneck is sales reconciliation across 4 spreadsheets — eating 18 hours/week between her and 2 staff. Wants real-time KPI dashboard, weekly close 3 days → 4 hours. Decision: her + the CFO.',
    sector_classification: 'distribucion',
    est_hours_saved: 18,
    est_payback_months: 3,
    suggested_capability: 'C.01+C.04'
  }
};

// In-memory cache: token → { payload, model, pipeline_version, ts }
// Cleared on server restart (intentional — regenerate to get fresh data).
export const DEMO_CACHE = new Map();
