import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMNOX_HOME, MEMORY_EXTRACT_SYSTEM } from '@memnox/core';
import { brainEnv } from '../operator/claude-brain';

/**
 * Extraction on the person's own Claude Code, logged in as they already are, so their notes never
 * leave their machine through Memnox. No tools, no MCP server and none of their settings: it can
 * only write candidates back, which the runtime then holds to its own parser.
 */

/** Good enough to read notes for decisions, and the same model the rule drafts use. */
const MEMORY_MODEL = 'sonnet';
/** Twenty passages take longer than one spoken rule; past this the batch waits for the next read. */
const EXTRACT_MS = 120_000;

/** Runs the CLI once with the prompt on standard input; null when it is missing, failed or took too long. */
export type ExtractRun = (prompt: string) => Promise<string | null>;

/** The person's Claude Code in a folder with no project, so no project's memory rides along. */
export function claudeExtractor(home: string): ExtractRun {
  return async (prompt) => {
    const cwd = join(home, MEMNOX_HOME, 'memory');
    await mkdir(cwd, { recursive: true });
    return runOnce(prompt, cwd);
  };
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
