import type { HoldRequest } from './hold';
import { redactSecrets } from '../domain/redact';
import { holdImpact, type HoldImpact } from './hold-impact';
import type { WorkEvidence } from '../session/work-evidence';

/**
 * A held call in the words a person reads it in: who wants to do what, why they are being
 * asked, and what the agent was working on. Written once here, so the session and the DM
 * put the same question the same way.
 */
export interface PlainAsk {
  /** "Claude Code wants to delete finish-cloud.patch." */
  summary: string;
  /** "delete finish-cloud.patch", so an answer can say what it allowed. */
  doing?: string;
  /** "You asked to check this yourself: sometimes it really is the build directory." */
  why: string;
  /** The person's own ask this session, quoted, so the action has its reason beside it. */
  task?: string;
  /** What it could affect, whether it can be undone, and what was verified, each with how it is known. */
  impact?: HoldImpact;
}

/** Long enough to recognise the ask, short enough to sit on one line of a phone screen. */
export const TASK_SHOWN_CHARS = 120;

const PRODUCT_NAMES: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  'codex-cli': 'Codex',
  cursor: 'Cursor',
  cline: 'Cline',
  vscode: 'VS Code',
  'gemini-cli': 'Gemini CLI',
  windsurf: 'Windsurf',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  ruflo: 'Ruflo',
  'github-actions': 'GitHub Actions',
};

/** The product a person knows, where the id is one; otherwise the id as it came. */
export function agentShown(agent: string): string {
  const bare = agent.startsWith('agt_') ? agent.slice('agt_'.length) : agent;
  if (bare === '' || bare === 'an agent') return 'An agent';
  return PRODUCT_NAMES[bare] ?? bare;
}

/** What the action does, as a verb phrase with room for its target. */
const DOING: Readonly<Record<string, string>> = {
  'filesystem.read': 'read',
  'filesystem.write': 'edit',
  'filesystem.delete': 'delete',
  'environment.read': 'read the secrets in',
  'shell.execute': 'run',
  'process.exec': 'run',
  'http.request': 'connect to',
  'git.push': 'push',
  'git.push-force': 'force-push, overwriting the remote history of',
  'git.push-f': 'force-push, overwriting the remote history of',
  'git.reset': 'reset',
  'git.reset-hard': 'throw away uncommitted changes with a hard reset of',
  'git.clean': 'delete untracked files in',
  'git.clean-fd': 'delete untracked files and folders in',
  'git.clean-f': 'delete untracked files in',
  'git.merge': 'merge',
  'git.commit': 'commit to',
  'git.branch-d': 'delete the branch',
};

/** What a target is called, where it is not a plain name a person would recognise. */
function targetShown(target: string): string {
  // Recorded before the shell expanded it, so the real path is only known when it runs.
  if (/^\$\{?\w+\}?$/.test(target.trim()))
    return `a path its command keeps in ${target.trim()}, which only resolves when it runs`;
  return target;
}

function doing(request: Pick<HoldRequest, 'operation' | 'target'>): string {
  const target = request.target === undefined ? undefined : targetShown(request.target);
  if (request.operation.startsWith('mcp.')) {
    const parts = request.operation.split('.');
    const tool = parts[parts.length - 1] ?? '';
    const server = parts.length > 2 ? parts[1] : undefined;
    return server === undefined ? `use the tool ${tool}` : `use ${tool} on ${server}`;
  }
  const verb = DOING[request.operation];
  if (verb === undefined)
    return target === undefined
      ? `do ${request.operation}`
      : `do ${request.operation} on ${target}`;
  if (target === undefined) {
    const bare = verb.replace(/ (of|in|to)$/, '');
    return bare === 'run' ? 'run a command' : bare;
  }
  return `${verb} ${target}`;
}

const REASON_OPENINGS: readonly [RegExp, string][] = [
  [/^you chose to be asked about this:\s*/i, 'You asked to check this yourself: '],
  [/^you chose to deny this:\s*/i, 'You chose to block this: '],
  [/^you chose to be asked about this\.?$/i, 'You asked to check this yourself.'],
];

/** The rule's reason as a sentence to the person, rather than a log line about them. */
export function whyShown(reason: string): string {
  let said = reason.trim();
  for (const [opening, plain] of REASON_OPENINGS) {
    if (opening.test(said)) {
      said = said.replace(opening, plain);
      break;
    }
  }
  if (said === '') return 'A rule on this machine asks a person first.';
  const sentence = said.charAt(0).toUpperCase() + said.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** The ask cut at a word, since a sentence stopped mid-word reads as a fault. */
export function taskShown(statement: string): string | undefined {
  const flat = statement.replace(/\s+/g, ' ').trim();
  if (flat === '') return undefined;
  if (flat.length <= TASK_SHOWN_CHARS) return flat;
  const cut = flat.slice(0, TASK_SHOWN_CHARS);
  const at = cut.lastIndexOf(' ');
  return `${(at > TASK_SHOWN_CHARS / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

export function plainAsk(
  request: Pick<HoldRequest, 'agent' | 'operation' | 'target' | 'reason'> &
    Partial<Pick<HoldRequest, 'class'>>,
  task?: string,
  /** What the session recorded about its tests, where the caller has it. */
  work?: WorkEvidence,
): PlainAsk {
  // This wording reaches the control plane and a DM, so no credential in a target or a prompt rides along.
  const shownTask = task === undefined ? undefined : taskShown(redactSecrets(task));
  const action = redactSecrets(doing(request));
  return {
    summary: `${agentShown(request.agent)} wants to ${action}.`,
    doing: action,
    why: redactSecrets(whyShown(request.reason)),
    ...(shownTask === undefined ? {} : { task: shownTask }),
    impact: holdImpact(request, work),
  };
}
