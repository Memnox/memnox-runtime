// Written by memnox setup, and taken out by memnox uninstall. Edits here are replaced.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ARGV = __MEMNOX_ARGV__;
// The same hook as the other agents run, spelled as their settings spell it.
const COMMAND = __MEMNOX_COMMAND__;
const MOST_MS = __MEMNOX_WAIT_MS__;
const TIMEOUT_MS = __MEMNOX_TIMEOUT_MS__;
const BLOCK_EXIT = 2;
const EVENT = __MEMNOX_EVENTS__;

function sessionOf(ctx) {
  return (ctx && (ctx.sessionKey || ctx.sessionId)) || '';
}

// With ~ spelled out, and still relative where it was written relative.
function withHome(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const path = value.trim();
  if (path === '~') return homedir();
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

function expanded(value) {
  const path = withHome(value);
  return path === undefined ? undefined : resolve(path);
}

// The live config where OpenClaw offers it, since the one given at registration is a snapshot.
function configOf(api) {
  try {
    const live = api.runtime && api.runtime.config && api.runtime.config.current && api.runtime.config.current();
    if (live) return live;
  } catch {}
  return api.config || {};
}

function defaultAgent(cfg) {
  const entries = (cfg.agents && cfg.agents.entries) || {};
  const ids = Object.keys(entries);
  return ids.find((id) => entries[id] && entries[id].default === true) || (ids.length === 1 ? ids[0] : 'main');
}

// OpenClaw's own resolver where it is exposed, and its rules from the config where not.
function workspaceOf(api, cfg, id) {
  try {
    const found = api.runtime.agent.resolveAgentWorkspaceDir(cfg, id);
    if (typeof found === 'string' && found !== '') return found;
  } catch {}
  const agents = cfg.agents || {};
  const own = expanded(agents.entries && agents.entries[id] && agents.entries[id].workspace);
  if (own) return own;
  const shared = expanded(agents.defaults && agents.defaults.workspace);
  const state = expanded(process.env.OPENCLAW_STATE_DIR) || join(homedir(), '.openclaw');
  if (id === defaultAgent(cfg)) return shared || expanded(process.env.OPENCLAW_WORKSPACE_DIR) || join(state, 'workspace');
  return shared ? join(shared, id) : join(state, 'workspace-' + id);
}

// Where OpenClaw resolves this call's relative paths, so a rule meets the file it really names.
// A sandboxed call names paths inside its container, which no directory here would make true.
function rootOf(api, ctx) {
  try {
    const cfg = configOf(api);
    const id = (ctx && ctx.agentId) || defaultAgent(cfg);
    const agents = cfg.agents || {};
    const own = (agents.entries && agents.entries[id]) || {};
    const defaults = agents.defaults || {};
    const mode = (own.sandbox && own.sandbox.mode) || (defaults.sandbox && defaults.sandbox.mode) || 'off';
    if (mode === 'all' || (mode === 'non-main' && !sessionOf(ctx).endsWith(':main'))) return { sandboxed: true };
    const workspace = workspaceOf(api, cfg, id);
    // A relative run directory is the workspace's, never the gateway's own.
    const cwd = withHome(own.cwd || defaults.cwd);
    return { cwd: cwd === undefined ? workspace : resolve(workspace, cwd) };
  } catch {
    return {};
  }
}

// The hook's answer, or null where it could not be asked: a call it never saw goes ahead.
function run(payload, signal) {
  return new Promise((done) => {
    let body;
    try {
      body = JSON.stringify(payload);
    } catch {
      done(null);
      return;
    }
    const child = spawn(ARGV[0], ARGV.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const stop = () => child.kill();
    const timer = setTimeout(stop, MOST_MS);
    if (signal) signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', () => {
      clearTimeout(timer);
      done(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
      done({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body);
  });
}

// OpenClaw's block or its approval, whose answer is handed back so the ledger names it.
function verdict(answer, answered) {
  if (answer === null) return undefined;
  if (answer.code === BLOCK_EXIT) {
    return { block: true, blockReason: answer.stderr.trim() || 'Memnox refused this.' };
  }
  const line = answer.stdout.split('\n').find((each) => each.trim() !== '');
  if (line === undefined) return undefined;
  let said;
  try {
    said = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (said.decision === 'block') return { block: true, blockReason: said.reason };
  if (said.decision === 'ask') {
    return {
      requireApproval: {
        title: 'Memnox',
        description: said.reason,
        severity: 'warning',
        allowedDecisions: ['allow-once', 'deny'],
        onResolution: answered,
      },
    };
  }
  return undefined;
}

export default {
  id: __MEMNOX_PLUGIN_ID__,
  name: 'Memnox',
  description: 'Rules on every tool call and records each session in the Memnox ledger.',
  register(api) {
    const said = (answer) => {
      if (answer === null) api.logger.warn('memnox: could not run ' + COMMAND);
      return answer;
    };
    const callOf = (name, event, ctx) => ({
      hook_event_name: name,
      session_id: sessionOf(ctx),
      agent_id: ctx && ctx.agentId,
      tool_name: event.toolName,
      tool_use_id: event.toolCallId,
      tool_input: event.params || {},
      ...rootOf(api, ctx),
    });
    api.on(
      EVENT.BEFORE_TOOL,
      async (event, ctx) => {
        const call = callOf(EVENT.BEFORE_TOOL, event, ctx);
        const answered = async (decision) => {
          said(await run({ ...call, hook_event_name: EVENT.APPROVAL_RESOLVED, decision }));
        };
        return verdict(said(await run(call, ctx && ctx.abortSignal)), answered);
      },
      { timeoutMs: TIMEOUT_MS },
    );
    api.on(EVENT.AFTER_TOOL, async (event, ctx) => {
      const result = event.error === undefined ? event.result : event.error;
      said(await run({ ...callOf(EVENT.AFTER_TOOL, event, ctx), tool_response: result }));
    });
    for (const name of [EVENT.SESSION_START, EVENT.SESSION_END]) {
      api.on(name, async (event, ctx) => {
        const session = sessionOf(ctx) || event.sessionKey || event.sessionId || '';
        said(await run({ hook_event_name: name, session_id: session }));
      });
    }
  },
};
