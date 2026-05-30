// api/_lib/agent-loader.js
// Reads .claude/agents/*.md at module load. Parses minimal frontmatter and
// builds a registry the orchestrator (dashboard-agents.js) uses to dispatch.
//
// File format: see .claude/agents/README-dashboard-agents.md
//
// ALL agents in this project live flat in .claude/agents/:
//   - Claude Code subagents (architect, critic, director, etc.) — used by
//     Claude Code at dev time via the Agent tool. They DO NOT have a `model:`
//     frontmatter field.
//   - Runtime dashboard agents (kpi_designer, headline_writer, etc.) — loaded
//     by THIS module at request time. They DO have a `model:` field.
//
// We filter by the presence of `model:` so this loader only picks up the
// runtime agents and ignores the Claude Code subagent definitions.
//
// Caches results — restart the dev server after editing an agent file.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Walks up from api/_lib/ → repo root → .claude/agents/
const AGENTS_DIR = join(__dirname, '..', '..', '.claude', 'agents');

// Tiny frontmatter parser — handles the constrained format used by this project.
// Supports scalars (string, int, bool), lists (-prefixed), no nested objects.
function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) throw new Error('Missing or malformed frontmatter (--- ... ---)');
  const [, yaml, body] = m;
  const out = {};
  const lines = yaml.split(/\r?\n/);
  let currentKey = null;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (raw.startsWith('  - ') || raw.startsWith('- ')) {
      // list item belonging to currentKey
      if (!currentKey) continue;
      const val = raw.replace(/^\s*-\s+/, '').trim();
      if (!Array.isArray(out[currentKey])) out[currentKey] = [];
      out[currentKey].push(stripQuotes(val));
      continue;
    }
    const idx = raw.indexOf(':');
    if (idx === -1) continue;
    const key = raw.slice(0, idx).trim();
    const rest = raw.slice(idx + 1).trim();
    currentKey = key;
    if (rest === '') {
      // value continues on next line(s) as a list
      out[key] = [];
    } else {
      out[key] = coerce(stripQuotes(rest));
    }
  }
  return { meta: out, body: body.trim() };
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

// Load all agents once at module init.
const REGISTRY = new Map();
const LOAD_ERRORS = [];

try {
  const files = readdirSync(AGENTS_DIR).filter(f =>
    f.endsWith('.md') && !f.startsWith('README')
  );
  for (const fname of files) {
    const fullPath = join(AGENTS_DIR, fname);
    try {
      const raw = readFileSync(fullPath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      // Filter: only files with `keywords:` array in frontmatter are RUNTIME
      // dashboard agents. Claude Code subagents (architect, critic, etc.) use
      // `tools:` instead, and don't need keyword-based dispatch. Silently skip.
      if (!Array.isArray(meta.keywords) || meta.keywords.length === 0) continue;
      if (!meta.name) throw new Error('Frontmatter missing required "name"');
      if (!meta.model) throw new Error('Frontmatter missing required "model"');
      REGISTRY.set(meta.name, {
        name:             meta.name,
        description:      meta.description || '',
        model:            meta.model,
        max_tokens:       meta.max_tokens || 800,
        keywords:         Array.isArray(meta.keywords) ? meta.keywords : [],
        output_field:     meta.output_field || meta.name,
        output_transform: meta.output_transform || 'passthrough',
        prompt_template:  body,
        source_path:      fullPath
      });
    } catch (e) {
      LOAD_ERRORS.push({ file: fname, error: e.message });
      console.error(`[agent-loader] failed to load ${fname}:`, e.message);
    }
  }
} catch (e) {
  console.error('[agent-loader] could not read agents directory:', AGENTS_DIR, e.message);
}

console.log(`[agent-loader] loaded ${REGISTRY.size} agent(s) from ${AGENTS_DIR}${LOAD_ERRORS.length ? ` (${LOAD_ERRORS.length} errors)` : ''}`);

export function listAgents() {
  return Array.from(REGISTRY.values());
}

export function getAgent(name) {
  return REGISTRY.get(name) || null;
}

// Resolves ${LANG} and ${ADMIN_FOCUS_LINE} placeholders in the prompt body.
export function resolvePrompt(template, { language = 'en', adminFocus = '' } = {}) {
  const lang = language === 'es' ? 'Spanish' : 'English';
  const focus = adminFocus
    ? (language === 'es' ? `Enfoque del admin: ${adminFocus}` : `Admin focus: ${adminFocus}`)
    : '';
  return template
    .replace(/\$\{LANG\}/g, lang)
    .replace(/\$\{ADMIN_FOCUS_LINE\}/g, focus);
}

export function getLoadErrors() {
  return LOAD_ERRORS.slice();
}
