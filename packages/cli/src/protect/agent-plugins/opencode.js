// Written by memnox setup, and taken out by memnox uninstall. Edits here are replaced.
import { spawn } from 'node:child_process';

const ARGV = __MEMNOX_ARGV__;
// The same hook as the other agents run, spelled as their settings spell it.
const COMMAND = __MEMNOX_COMMAND__;
const MOST_MS = __MEMNOX_WAIT_MS__;
const BLOCK_EXIT = 2;
const EVENT = __MEMNOX_EVENTS__;

// The hook's answer, or null where it could not be asked: a call it never saw goes ahead.
function run(payload) {
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
    const timer = setTimeout(() => child.kill(), MOST_MS);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', () => {
      clearTimeout(timer);
      done(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body);
  });
}

// Why the hook refused, or null where it let the call go on.
function refusal(answer) {
  if (answer === null) {
    console.warn('memnox: could not run ' + COMMAND);
    return null;
  }
  if (answer.code === BLOCK_EXIT) return answer.stderr.trim() || 'Memnox refused this.';
  const line = answer.stdout.split('\n').find((each) => each.trim() !== '');
  if (line === undefined) return null;
  try {
    const said = JSON.parse(line);
    return said.decision === 'block' ? String(said.reason || 'Memnox refused this.') : null;
  } catch {
    return null;
  }
}

export const MemnoxPlugin = async ({ directory }) => {
  const callOf = (name, input, args) => ({
    hook_event_name: name,
    session_id: (input && input.sessionID) || '',
    tool_name: input && input.tool,
    tool_use_id: input && input.callID,
    tool_input: args || {},
    cwd: directory,
  });
  return {
    'tool.execute.before': async (input, output) => {
      const reason = refusal(await run(callOf(EVENT.PRE_TOOL, input, output && output.args)));
      if (reason !== null) throw new Error(reason);
    },
    'tool.execute.after': async (input, output) => {
      const call = callOf(EVENT.POST_TOOL, input, input && input.args);
      refusal(await run({ ...call, tool_response: output && output.output }));
    },
    event: async ({ event }) => {
      const props = (event && event.properties) || {};
      if (event.type === 'session.idle' && props.sessionID) {
        await run({ hook_event_name: EVENT.TURN_END, session_id: props.sessionID, cwd: directory });
      }
      if (event.type === 'session.deleted' && props.info && props.info.id) {
        await run({ hook_event_name: EVENT.SESSION_END, session_id: props.info.id, cwd: directory });
      }
    },
  };
};
