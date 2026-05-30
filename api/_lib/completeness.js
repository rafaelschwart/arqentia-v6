// api/_lib/completeness.js
// Single source of truth for "is this prospect's profile complete enough to
// generate a personalized demo dashboard?"
//
// Strict default: 8 of 11 fields are REQUIRED to unlock generation.
//   Required: name, email, industry, headcount, what-the-company-does,
//             main pain process, hours/week, tools, metric+target
//   Optional: data state (Q6), 90-day fix (Q7), role/decision-unit (Q9), phone (Q10)
//
// `computeCompleteness(prospect, answers)` returns:
//   {
//     complete: boolean,         // all required fields present
//     percent: 0..100,           // proportional fill (counts optional too)
//     required_done: int,
//     required_total: int,
//     missing: [                 // ordered, exactly what the UI should ask for
//       { key, label_en, label_es, source, q_id }
//     ],
//     missing_optional: [ ... ]  // same shape but informational
//   }

const REQUIRED_FIELDS = [
  { key: 'name',     source: 'prospect', q_id: 'Q0',
    label_en: 'Your name',                label_es: 'Tu nombre' },
  { key: 'email',    source: 'prospect', q_id: 'Q0',
    label_en: 'Work email',               label_es: 'Email de trabajo' },
  { key: 'industry', source: 'answer.json', q_id: 'Q1', json_key: 'industry',
    label_en: 'Industry',                 label_es: 'Industria' },
  { key: 'headcount',source: 'answer.json', q_id: 'Q1', json_key: 'headcount',
    label_en: 'Team size',                label_es: 'Tamaño del equipo' },
  { key: 'business_description', source: 'answer.text', q_id: 'Q2',
    label_en: 'What your company does',   label_es: 'Qué hace tu empresa' },
  { key: 'main_pain',source: 'answer.json', q_id: 'Q3', json_key: 'process',
    label_en: 'Your biggest weekly pain', label_es: 'Tu mayor dolor semanal' },
  { key: 'hours_per_week', source: 'answer.text', q_id: 'Q4',
    label_en: 'Hours/week that pain eats',label_es: 'Horas/semana que consume' },
  { key: 'tools',    source: 'answer.json.array', q_id: 'Q5', json_key: 'tools',
    label_en: 'Tools you use today',      label_es: 'Herramientas que usas' },
  { key: 'metric_target', source: 'answer.json', q_id: 'Q8', json_key: 'metric',
    label_en: 'Success metric + target',  label_es: 'Métrica de éxito + objetivo' }
];

const OPTIONAL_FIELDS = [
  { key: 'data_state', source: 'answer.text', q_id: 'Q6',
    label_en: 'Where your data lives',    label_es: 'Dónde vive tu información' },
  { key: 'fix_90',     source: 'answer.json', q_id: 'Q7', json_key: 'fix',
    label_en: 'Your 90-day fix',          label_es: 'Tu solución para 90 días' },
  { key: 'role',       source: 'prospect', q_id: 'Q9',
    label_en: 'Your role',                label_es: 'Tu rol' },
  { key: 'phone',      source: 'prospect', q_id: 'Q10',
    label_en: 'WhatsApp / phone',         label_es: 'WhatsApp / teléfono' }
];

function isFilled(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function getFieldValue(field, prospect, answersByQ) {
  if (field.source === 'prospect') {
    return prospect?.[field.key] ?? null;
  }
  const ans = answersByQ.get(field.q_id);
  if (!ans) return null;
  if (field.source === 'answer.text') return ans.value_text ?? null;
  if (field.source === 'answer.json') return ans.value_json?.[field.json_key] ?? null;
  if (field.source === 'answer.json.array') {
    const arr = ans.value_json?.[field.json_key];
    return Array.isArray(arr) ? arr : null;
  }
  return null;
}

export function computeCompleteness(prospect, answers) {
  const answersByQ = new Map();
  for (const a of (answers || [])) {
    // Only keep the most recent / first row per question_id
    if (!answersByQ.has(a.question_id)) answersByQ.set(a.question_id, a);
  }

  const evaluate = (fields) => fields.map(f => ({
    ...f,
    value: getFieldValue(f, prospect, answersByQ),
    filled: isFilled(getFieldValue(f, prospect, answersByQ))
  }));

  const reqEval = evaluate(REQUIRED_FIELDS);
  const optEval = evaluate(OPTIONAL_FIELDS);

  const required_done  = reqEval.filter(f => f.filled).length;
  const required_total = reqEval.length;
  const optional_done  = optEval.filter(f => f.filled).length;
  const optional_total = optEval.length;

  const complete = required_done === required_total;
  // Percent: required carries 70% of the bar, optional the rest 30%
  const percent = Math.round(
    (required_done / required_total) * 70 +
    (optional_done / optional_total) * 30
  );

  const missing = reqEval
    .filter(f => !f.filled)
    .map(({ key, label_en, label_es, source, q_id, json_key }) => ({ key, label_en, label_es, source, q_id, json_key }));
  const missing_optional = optEval
    .filter(f => !f.filled)
    .map(({ key, label_en, label_es, source, q_id, json_key }) => ({ key, label_en, label_es, source, q_id, json_key }));

  return { complete, percent, required_done, required_total, optional_done, optional_total, missing, missing_optional };
}

export { REQUIRED_FIELDS, OPTIONAL_FIELDS };
