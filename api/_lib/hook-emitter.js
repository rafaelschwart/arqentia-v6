/**
 * Emit SubagentStart/Stop hooks to KAI Panel Visual so agents appear in Nerdy Claude OS
 *
 * The Arqentia dashboard agents run in the backend via the Anthropic SDK, but they
 * don't fire Claude Code hooks automatically. This module sends HTTP requests to the
 * KAI Panel Visual backend to report agent activity.
 */

const DASHBOARD_BACKEND = process.env.DASHBOARD_BACKEND_URL || 'http://localhost:3001';

export async function emitSubagentStart(agentName, agentType = 'dashboard-agent') {
  try {
    const res = await fetch(`${DASHBOARD_BACKEND}/hooks/subagent-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_type: agentType,
        subagent_type: agentName,
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      }),
      timeout: 3000,
    });
    if (!res.ok) console.warn(`[hook-emitter] SubagentStart failed: ${res.status}`);
  } catch (err) {
    console.warn(`[hook-emitter] SubagentStart error: ${err.message}`);
  }
}

export async function emitSubagentStop(agentName, status = 'completed', agentType = 'dashboard-agent') {
  try {
    const res = await fetch(`${DASHBOARD_BACKEND}/hooks/subagent-stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_type: agentType,
        subagent_type: agentName,
        status,
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      }),
      timeout: 3000,
    });
    if (!res.ok) console.warn(`[hook-emitter] SubagentStop failed: ${res.status}`);
  } catch (err) {
    console.warn(`[hook-emitter] SubagentStop error: ${err.message}`);
  }
}
