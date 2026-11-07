import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMNOX_HOME, MEMORY_EXTRACT_SYSTEM } from '@memnox/core';
import { AcpBrain } from '../operator/acp-brain';
import { BRAIN_CHUNK } from '../operator/brain';
import { brainEnv } from '../operator/claude-brain';
import { voiceAgentsFor } from '../operator/own-brain';
import { VOICE_BRAIN, type VoiceBrainSpec } from '../operator/voice-brains';

/**
 * Extraction on the person's own agent, logged in as they already are, so their notes never leave
 * their machine through Memnox. No tools, no MCP server, read only, and every permission refused:
 * it can only write candidates back, which the runtime then holds to its own parser.
 */

/** Good enough to read notes for decisions, and the same model the rule drafts use. */
const MEMORY_MODEL = 'sonnet';
/** Twenty passages take longer than one spoken rule; past this the batch waits for the next read. */
const EXTRACT_MS = 120_000;

/** Runs the CLI once with the prompt on standard input; null when it is missing, failed or took too long. */
export type ExtractRun = (prompt: string) => Promise<string | null>;

interface ExtractorSeams {
  /** The agents to try, in order; the person's voice preference unless a test names its own. */
  brains?: () => Promise<VoiceBrainSpec[]>;
  /** The binary for an agent, where a test stands one in. */
  command?: (spec: VoiceBrainSpec) => string | undefined;
  claude?: (prompt: string, cwd: string) => Promise<string | null>;
}

/**
 * The person's agents in their voice's preference order, the first that answers doing the read, in a
 * folder with no project so no project's memory rides along. Only an agent that can be shut into
 * reading is asked, since the notes are untrusted text and an unsealed one could act on them.
 */
export function ownExtractor(home: string, seams: ExtractorSeams = {}): ExtractRun {
  const brains = seams.brains ?? (() => voiceAgentsFor(home).preferred());
  return async (prompt) => {
    const cwd = join(home, MEMNOX_HOME, 'memory');
    await mkdir(cwd, { recursive: true });
    for (const spec of (await brains()).filter((each) => each.sealed)) {
      const answer =
        spec.kind === VOICE_BRAIN.CLAUDE_CODE
          ? await (seams.claude ?? runOnce)(prompt, cwd)
          : await acpOnce(spec, { home, cwd, prompt, command: seams.command?.(spec) });
      if (answer !== null) return answer;
    }
    return null;
  };
}

/** One read on an ACP agent in its read-only mode, with no tools; null when it failed, refused or ran long. */
async function acpOnce(
  spec: VoiceBrainSpec,
  run: { home: string; cwd: string; prompt: string; command: string | undefined },
): Promise<string | null> {
  const brain = new AcpBrain({
    spec,
    home: run.home,
    cwd: run.cwd,
    instructions: MEMORY_EXTRACT_SYSTEM,
    remember: false,
    ...(run.command === undefined ? {} : { command: run.command }),
  });
  const deadline = setTimeout(() => brain.cancel(), EXTRACT_MS);
  let text = '';
  let done = false;
  try {
    for await (const chunk of brain.ask(run.prompt)) {
      if (chunk.kind === BRAIN_CHUNK.TEXT) text += chunk.text ?? '';
      if (chunk.kind === BRAIN_CHUNK.DONE) done = true;
    }
  } finally {
    clearTimeout(deadline);
    brain.close();
  }
  return done && text.trim() !== '' ? text : null;
}

function runOnce(prompt: string, cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('claude', extractArgs(), {
      cwd,
      env: brainEnv(process.env),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let out = '';
    const deadline = setTimeout(() => child.kill('SIGTERM'), EXTRACT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    // A missing binary surfaces as a close with no answer, since `close` follows every spawn error.
    child.on('error', () => undefined);
    child.on('close', (code) => {
      clearTimeout(deadline);
      resolve(code === 0 && out.trim() !== '' ? out : null);
    });
    child.stdin.end(prompt);
  });
}

/** Claude Code with every tool off and nothing of the person's settings. */
function extractArgs(): string[] {
  return [
    '-p',
    '--output-format',
    'text',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify({ mcpServers: {} }),
    '--setting-sources',
    'project',
    '--system-prompt',
    MEMORY_EXTRACT_SYSTEM,
    '--model',
    MEMORY_MODEL,
  ];
}
