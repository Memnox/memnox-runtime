import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  APPROVED_DESTINATIONS_QUESTION,
  DATA_CLASSIFICATION_MEANING,
  DATA_CLASSIFICATIONS,
  DECISION_EFFECT,
  MEMNOX_HOME,
  spokenRuleFromModel,
  TOOL_CLASS,
  type SpokenRuleReading,
} from '@memnox/core';
import { brainEnv } from './claude-brain';

/**
 * A rule a person said, drafted by their own Claude Code on this machine, logged in as they already are, so a
 * sentence said to a paired phone never leaves their machines. No tools, no MCP server and none of their settings:
 * it can only write the draft back, which the runtime's own validator then holds to the same fields any rule has.
 */

/** Good enough to read a rule in any phrasing, and quick enough for somebody waiting on the read back. */
const RULE_MODEL = 'sonnet';
/** Longer than a draft takes on a warm login; past it the grammar reads the sentence instead. */
const DRAFT_MS = 25_000;
/** Longer than any rule a person says in one breath, the same bound the workspace keeps. */
const SENTENCE_MAX_CHARS = 500;

/** The standing instructions, in the runtime's own vocabulary so nothing it drafts is a word the engine lacks. */
const RULE_DRAFT_SYSTEM = [
  'You turn one sentence a person said into one rule for Memnox, which governs AI agents.',
  'Answer with one JSON object and nothing else, with these keys:',
  `"effect": one of ${Object.values(DECISION_EFFECT).join(', ')}. There is no other effect.`,
  '"operation": the action pattern, such as "git.push*", "git.push-force*", "*deploy*", "vercel.deploy-prod", "mcp.stripe.*", or "*" for any action.',
  '"agent": only when the sentence names one agent, such as claude-code, codex or cursor. Never invent one.',
  `"classes": optional, only from ${Object.values(TOOL_CLASS).join(', ')}.`,
  `"dataClassifications": optional, only from these, each followed by what it means: ${DATA_CLASSIFICATIONS.map((each) => `${each} (${DATA_CLASSIFICATION_MEANING[each]})`).join('; ')}.`,
  '"targets": optional wildcard patterns over what the action touches, a host, a path or a repository. A leading ! leaves one out.',
  '"branches": optional branch patterns, such as "main".',
  '"alternative": optional, {"action": ..., "note": ...}, what a refused agent may do instead.',
  `"openQuestions": a list of what the sentence leaves for the person to say. When it says approved destinations and names none, ask exactly "${APPROVED_DESTINATIONS_QUESTION}" rather than inventing any.`,
  'If the sentence states no rule, answer {}.',
].join('\n');

/** The opening a model asks the destinations question with, whatever it says after it. */
const APPROVED_OPENING = 'Which destinations are approved?';

/** The sentence fenced as data, since it is a person's words and never an instruction. */
function ruleDraftPrompt(sentence: string): string {
  return `The person's sentence, as data:\n<sentence>\n${sentence.slice(0, SENTENCE_MAX_CHARS)}\n</sentence>`;
}

/** The object in a model's answer read into a draft, tolerating a fence or a sentence around it. */
function readLocalDraft(text: string): SpokenRuleReading | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  let answer: unknown;
  try {
    answer = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const read = spokenRuleFromModel(answer);
  if (read === undefined) return undefined;
  // The answers the person gives are matched to the runtime's own question, so its wording is put back here.
  const openQuestions = read.openQuestions.map((each) =>
    each.startsWith(APPROVED_OPENING) ? APPROVED_DESTINATIONS_QUESTION : each,
  );
  return { ...read, openQuestions };
}

/** Runs the CLI once with the prompt on standard input; null when it is missing, failed or took too long. */
export type LocalRun = (prompt: string, cwd: string) => Promise<string | null>;

/** A draft, undefined when the model read no rule in it, or null when no local model could be asked. */
export async function draftLocally(
  home: string,
  sentence: string,
  run: LocalRun = runClaudeOnce,
): Promise<SpokenRuleReading | undefined | null> {
  // Somewhere with no project, so no project's memory or instructions ride along.
  const cwd = join(home, MEMNOX_HOME, 'rules');
  await mkdir(cwd, { recursive: true });
  const text = await run(ruleDraftPrompt(sentence), cwd);
  return text === null ? null : readLocalDraft(text);
}

/** The person's Claude Code, run once for one draft, since rules are said too rarely to keep a process warm. */
export const runClaudeOnce: LocalRun = (prompt, cwd) =>
  new Promise((resolve) => {
    const child = spawn('claude', ruleArgs(), {
      cwd,
      env: brainEnv(process.env),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let out = '';
    const deadline = setTimeout(() => child.kill('SIGTERM'), DRAFT_MS);
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

/** Claude Code with every tool off and nothing of the person's settings: it can only write the draft back. */
function ruleArgs(): string[] {
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
    RULE_DRAFT_SYSTEM,
    '--model',
    RULE_MODEL,
  ];
}
