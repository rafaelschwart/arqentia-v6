// api/_lib/questions.js

export const QUESTIONS = [
  {
    id: 'Q1', section: 1, section_label: { en: 'Business', es: 'Negocio' },
    prompt: {
      en: 'What kind of business are you running?',
      es: '¿Qué tipo de negocio diriges?'
    },
    inputs: [
      { name: 'industry', type: 'select', required: true, options: [
        { value: 'distribucion', label: { en: 'Distribution',    es: 'Distribución' } },
        { value: 'retail',       label: { en: 'Retail',          es: 'Retail' } },
        { value: 'manufactura',  label: { en: 'Manufacturing',   es: 'Manufactura' } },
        { value: 'servicios',    label: { en: 'Services',        es: 'Servicios' } },
        { value: 'logistica',    label: { en: 'Logistics',       es: 'Logística' } },
        { value: 'salud',        label: { en: 'Healthcare',      es: 'Salud' } },
        { value: 'construccion', label: { en: 'Construction',    es: 'Construcción' } },
        { value: 'educacion',    label: { en: 'Education',       es: 'Educación' } },
        { value: 'other',        label: { en: 'Other',           es: 'Otro' } }
      ]},
      { name: 'headcount', type: 'select', required: true, options: [
        { value: 'solo',     label: { en: 'Just me',  es: 'Solo yo' } },
        { value: '1-10',     label: '1–10' },
        { value: '11-50',    label: '11–50' },
        { value: '51-200',   label: '51–200' },
        { value: '200+',     label: '200+' }
      ]}
    ]
  },
  {
    id: 'Q2', section: 1,
    prompt: {
      en: 'In one sentence — what does your company actually do day-to-day?',
      es: 'En una oración: ¿qué hace tu empresa día a día?'
    },
    inputs: [{ name: 'description', type: 'textarea', maxLength: 280, required: true, placeholder: { en: 'e.g., We distribute consumer goods to 380 bodegas in Lima — daily routes, weekly invoicing.', es: 'ej., Distribuimos productos a 380 bodegas en Lima — rutas diarias, facturación semanal.' } }]
  },
  {
    id: 'Q3', section: 2, section_label: { en: 'Operations today', es: 'Operaciones hoy' },
    prompt: {
      en: "What's the most painful manual process you run every week?",
      es: '¿Cuál es el proceso manual más doloroso que ejecutas cada semana?'
    },
    inputs: [
      { name: 'process', type: 'text', required: true },
      { name: 'chips', type: 'chips', options: [
        { value: 'reconciling',  label: { en: 'Reconciling sales',    es: 'Conciliar ventas' } },
        { value: 'reports',      label: { en: 'Building reports',      es: 'Armar reportes' } },
        { value: 'followups',    label: { en: 'Following up clients',  es: 'Hacer seguimientos' } },
        { value: 'inventory',    label: { en: 'Inventory counts',      es: 'Inventarios' } },
        { value: 'approvals',    label: { en: 'Approvals chain',       es: 'Cadena de aprobaciones' } },
        { value: 'payroll',      label: { en: 'Payroll',               es: 'Planilla' } },
        { value: 'other',        label: { en: 'Other',                 es: 'Otro' } }
      ]}
    ],
    followup_strategy: 'ai_one_of_three'
  },
  {
    id: 'Q4', section: 2,
    prompt: {
      en: 'How many hours per week does that eat — you + your team combined?',
      es: '¿Cuántas horas a la semana te consume — tú + tu equipo combinados?'
    },
    inputs: [{ name: 'hours_range', type: 'chips', required: true, options: [
      { value: '1-5',   label: '1–5h' },
      { value: '5-10',  label: '5–10h' },
      { value: '10-20', label: '10–20h' },
      { value: '20-40', label: '20–40h' },
      { value: '40+',   label: '40+h' }
    ]}]
  },
  {
    id: 'Q5', section: 3, section_label: { en: 'Tools & data', es: 'Herramientas y datos' },
    prompt: {
      en: 'What tools touch this process today?',
      es: '¿Qué herramientas tocan este proceso hoy?'
    },
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
    prompt: {
      en: 'Where does the data actually live?',
      es: '¿Dónde vive realmente la información?'
    },
    inputs: [{ name: 'data_state', type: 'select', required: true, options: [
      { value: 'spreadsheets_many',    label: { en: 'Spreadsheets (multiple files)',     es: 'Spreadsheets (varios archivos)' } },
      { value: 'systems_disconnected', label: { en: "Multiple systems that don't talk",  es: 'Varios sistemas que no se hablan' } },
      { value: 'one_inconsistent',     label: { en: 'One ERP/CRM, inconsistent data',    es: 'Un ERP/CRM, datos inconsistentes' } },
      { value: 'paper_whatsapp',       label: { en: 'Paper / WhatsApp screenshots',      es: 'Papel / capturas de WhatsApp' } },
      { value: 'custom_db',            label: { en: 'Custom database',                   es: 'Base de datos propia' } },
      { value: 'mix',                  label: { en: 'Mix of everything',                 es: 'Mezcla de todo' } }
    ]}],
    followup_strategy: 'ai_if_systems_disconnected'
  },
  {
    id: 'Q7', section: 4, section_label: { en: 'Goals', es: 'Objetivos' },
    prompt: {
      en: 'If we could fix ONE thing in the next 90 days, what would have the biggest impact?',
      es: 'Si pudiéramos arreglar UNA cosa en los próximos 90 días, ¿qué tendría el mayor impacto?'
    },
    inputs: [
      { name: 'fix', type: 'text', required: true },
      { name: 'chips', type: 'chips', options: [
        { value: 'kpis',       label: { en: 'See real-time KPIs',       es: 'Ver KPIs en tiempo real' } },
        { value: 'reports',    label: { en: 'Eliminate manual reports', es: 'Eliminar reportes manuales' } },
        { value: 'approvals',  label: { en: 'Speed up approvals',       es: 'Acelerar aprobaciones' } },
        { value: 'errors',     label: { en: 'Reduce errors',            es: 'Reducir errores' } },
        { value: 'time',       label: { en: 'Free up my time',          es: 'Liberar mi tiempo' } },
        { value: 'onboarding', label: { en: 'Onboard clients faster',   es: 'Onboarding más rápido' } },
        { value: 'other',      label: { en: 'Other',                    es: 'Otro' } }
      ]}
    ],
    followup_strategy: 'ai_always'
  },
  {
    id: 'Q8', section: 4,
    prompt: {
      en: 'What does success look like in numbers?',
      es: '¿Cómo se ve el éxito en números?'
    },
    inputs: [
      { name: 'metric', type: 'text', required: true, placeholder: { en: 'e.g., weekly close time', es: 'ej. tiempo de cierre semanal' } },
      { name: 'target', type: 'text', required: true, placeholder: { en: 'e.g., 3 days → 4 hours',  es: 'ej. 3 días → 4 horas' } }
    ]
  },
  {
    id: 'Q9', section: 5, section_label: { en: 'You', es: 'Tú' },
    prompt: {
      en: 'Your role and who else needs to be in the room.',
      es: 'Tu rol y quién más necesita estar en la sala.'
    },
    inputs: [
      { name: 'role', type: 'select', required: true, options: [
        { value: 'ceo',     label: 'CEO' },
        { value: 'coo',     label: 'COO' },
        { value: 'ops',     label: { en: 'Ops Director',    es: 'Director de Operaciones' } },
        { value: 'finance', label: { en: 'Finance Manager', es: 'Gerente Financiero' } },
        { value: 'other',   label: { en: 'Other',           es: 'Otro' } }
      ]},
      { name: 'decision_unit', type: 'select', required: true, options: [
        { value: 'me',        label: { en: 'Just me',          es: 'Solo yo' } },
        { value: 'cofounder', label: { en: 'Me + co-founder',  es: 'Yo + co-founder' } },
        { value: 'ops_team',  label: { en: 'Me + ops team',    es: 'Yo + equipo ops' } },
        { value: 'finance',   label: { en: 'Me + finance',     es: 'Yo + finanzas' } },
        { value: 'exec',      label: { en: 'Me + exec team',   es: 'Yo + equipo ejecutivo' } }
      ]}
    ]
  },
  {
    id: 'Q10', section: 5,
    prompt: {
      en: 'Pick a discovery call slot and best phone.',
      es: 'Elige un horario para la llamada de descubrimiento y un teléfono.'
    },
    inputs: [
      { name: 'calendly_url', type: 'calendly' },
      { name: 'phone',        type: 'phone', required: true },
      { name: 'whatsapp_ok',  type: 'checkbox', default: true, label: { en: 'OK to follow up via WhatsApp', es: 'OK contactarme por WhatsApp' } }
    ]
  }
];

export function getById(id) { return QUESTIONS.find(q => q.id === id); }
export function getSection(id) { return getById(id)?.section ?? null; }

export function getNext(id) {
  if (id === 'Q4')  return { action: 'gate', next_anchor: 'Q5' };
  if (id === 'Q10') return { action: 'complete' };
  const i = QUESTIONS.findIndex(q => q.id === id);
  if (i < 0 || i + 1 >= QUESTIONS.length) return { action: 'complete' };
  return { action: 'next', next_anchor: QUESTIONS[i + 1].id };
}
