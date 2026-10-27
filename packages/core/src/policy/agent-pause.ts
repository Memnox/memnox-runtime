import { DISCOVERED_AGENT_KIND } from '../discovery/discovery.constants';
import { AGENT_SUBJECT_PREFIX, agentFrozen } from './agent-freeze';
import { freezeFor, inForce, OVERLAY_KIND, type Overlay } from './overlay';
import { readJsonFile } from '../store/json-records';
import {
  orgConditionsPathFor,
  readOverlays,
  writeOverlays,
  type OrgConditionsFile,
} from './overlay-store';

/**
 * One agent paused by the person at this machine, kept as a local freeze on `agent:<kind>` so
 * the gate reads it on the very next call from disk, with no heartbeat in between.
 */

/** A day, because an overlay must end and a pause nobody resumed should not outlive the week. */
export const AGENT_PAUSE_MINUTES = 24 * 60;

/** Where a local pause came from, which `memnox freeze` prints beside it. */
export const PAUSED_HERE = 'a person on this machine';

/** The words a person says for each product, beside its own kind. */
const SPOKEN: Readonly<Record<string, readonly string[]>> = {
  [DISCOVERED_AGENT_KIND.CLAUDE_CODE]: ['claude code', 'claude', 'cloud code'],
  [DISCOVERED_AGENT_KIND.CLAUDE_DESKTOP]: ['claude desktop', 'claude app', 'claude'],
  [DISCOVERED_AGENT_KIND.CODEX_CLI]: ['codex', 'codex cli', 'code x'],
  [DISCOVERED_AGENT_KIND.CURSOR]: ['cursor'],
  [DISCOVERED_AGENT_KIND.CLINE]: ['cline', 'klein', 'kline'],
  [DISCOVERED_AGENT_KIND.VS_CODE]: ['vs code', 'vscode', 'visual studio code'],
  [DISCOVERED_AGENT_KIND.GITHUB_ACTIONS]: ['github actions', 'actions'],
  [DISCOVERED_AGENT_KIND.HERMES]: ['hermes'],
  [DISCOVERED_AGENT_KIND.OPENCLAW]: ['openclaw', 'open claw'],
  [DISCOVERED_AGENT_KIND.RUFLO]: ['ruflo', 'roo flo'],
  [DISCOVERED_AGENT_KIND.GEMINI_CLI]: ['gemini', 'gemini cli'],
  [DISCOVERED_AGENT_KIND.WINDSURF]: ['windsurf', 'wind surf'],
  [DISCOVERED_AGENT_KIND.COPILOT_CLI]: ['copilot', 'copilot cli', 'co pilot'],
  [DISCOVERED_AGENT_KIND.DEVIN]: ['devin'],
  [DISCOVERED_AGENT_KIND.OPENCODE]: ['opencode', 'open code'],
};

/** Words around a name that say nothing about which agent: "pause the Codex agent". */
const FILLER = new Set(['the', 'agent', 'agents', 'my', 'please', 'session', 'sessions']);

/** A misheard name is one or two letters off; a shorter word that close is a different word. */
const MOST_EDITS = 2;
const SHORTEST_FUZZY = 5;

export type AgentNameMatch =
  { kind: string } | { ambiguous: string[] } | { unknown: string };

interface ResolveInput {
  said: string;
  /** Agent kinds present on this machine, which settle "Claude" when only one Claude is here. */
  present?: readonly string[];
  /** What the person named an agent, by kind. */
  names?: Readonly<Record<string, string>>;
}

/** The agent kind a spoken name means, or every candidate when it could mean more than one. */
export function resolveAgentName({ said, present, names }: ResolveInput): AgentNameMatch {
  const wanted = compact(said);
  if (wanted === '') return { unknown: said };
  const spellings = spellingsByKind(names);
  for (const tier of [exactly, containing, misheard]) {
    const found = [...spellings].filter(([, words]) =>
      words.some((w) => tier(wanted, w)),
    );
    const kinds = narrowed(
      found.map(([kind]) => kind),
      present,
    );
    if (kinds.length === 1) return { kind: kinds[0] as string };
    if (kinds.length > 1) return { ambiguous: kinds };
  }
  return { unknown: said };
}

function spellingsByKind(
  names: Readonly<Record<string, string>> | undefined,
): Map<string, string[]> {
  const spellings = new Map<string, string[]>();
  for (const kind of Object.values(DISCOVERED_AGENT_KIND)) {
    const own = [kind, ...(SPOKEN[kind] ?? [])];
    const named = names?.[kind];
    spellings.set(
      kind,
      [...own, ...(named === undefined ? [] : [named])].map(compact).filter(Boolean),
    );
  }
  return spellings;
}

/** Only the kinds on this machine when any of them match, since a pause elsewhere stops nothing. */
function narrowed(
  kinds: readonly string[],
  present: readonly string[] | undefined,
): string[] {
  const here = kinds.filter((kind) => present?.includes(kind) === true);
  return here.length > 0 ? here : [...kinds];
}

function exactly(wanted: string, spelling: string): boolean {
  return wanted === spelling;
}

function containing(wanted: string, spelling: string): boolean {
  return (
    spelling.length >= 4 && (wanted.includes(spelling) || spelling.startsWith(wanted))
  );
}

function misheard(wanted: string, spelling: string): boolean {
  if (wanted.length < SHORTEST_FUZZY || spelling.length < SHORTEST_FUZZY) return false;
  return editDistance(wanted, spelling) <= MOST_EDITS;
}

/** Lower case, letters and digits only, filler dropped, so "Claude-Code" is "claudecode". */
function compact(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word !== '' && !FILLER.has(word))
    .join('');
}

/** Levenshtein, iterative: a misheard name is a letter or two from what was meant. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      // Every index read here was written on this row or the one before it.
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/** Every freeze in force on this agent, by any of the names it goes by. */
function freezesOn(
  overlays: readonly Overlay[],
  kind: string,
  moment: string,
): Overlay[] {
  return inForce(overlays, moment).filter(
    (overlay) =>
      overlay.kind === OVERLAY_KIND.FREEZE &&
      agentFrozen([`${overlay.kind}:${overlay.subject}`], kind),
  );
}

export interface PauseInput {
  kind: string;
  now: string;
  /** What the person said, kept as the reason so the record says why in their words. */
  said?: string;
  minutes?: number;
}

export interface PauseOutcome {
  overlay: Overlay;
  /** False when a pause on this agent was already in force here, which is left as it was. */
  fresh: boolean;
}

/** Pauses one agent on this machine, at once, and returns the record a resume will lift. */
export async function pauseAgentHere(
  home: string,
  input: PauseInput,
): Promise<PauseOutcome> {
  const overlays = await readOverlays(home);
  const already = freezesOn(overlays, input.kind, input.now)[0];
  if (already !== undefined) return { overlay: already, fresh: false };
  const overlay = freezeFor({
    subject: `${AGENT_SUBJECT_PREFIX}${input.kind}`,
    reason:
      input.said === undefined || input.said.trim() === ''
        ? `${input.kind} paused by a person`
        : `paused by a person: "${input.said.trim()}"`,
    minutes: input.minutes ?? AGENT_PAUSE_MINUTES,
    now: input.now,
    source: PAUSED_HERE,
  });
  await writeOverlays(home, [...overlays, overlay]);
  return { overlay, fresh: true };
}

/** Lifts every local pause or freeze on this agent, kept in the record with when it ended. */
export async function resumeAgentHere(
  home: string,
  kind: string,
  now: string,
): Promise<Overlay[]> {
  const overlays = await readOverlays(home);
  const lifted = freezesOn(overlays, kind, now);
  if (lifted.length === 0) return [];
  for (const overlay of lifted) overlay.liftedAt = now;
  await writeOverlays(home, overlays);
  return lifted;
}

/** Records the workspace condition a pause was also declared as, so a resume can lift it there. */
export async function noteWorkspaceCondition(
  home: string,
  overlayId: string,
  conditionId: string,
): Promise<void> {
  const overlays = await readOverlays(home);
  const found = overlays.find((overlay) => overlay.id === overlayId);
  if (found === undefined) return;
  found.workspaceConditionId = conditionId;
  await writeOverlays(home, overlays);
}

/**
 * The workspace's own ids for the freezes on this agent this machine last pulled, so a resume here
 * also lifts one somebody pressed in the console. The bundle names each `<id>:<subject>`.
 */
export async function workspaceFreezeIds(home: string, kind: string): Promise<string[]> {
  const file = await readJsonFile<Partial<OrgConditionsFile>>(orgConditionsPathFor(home));
  if (file === null || !Array.isArray(file.conditions)) return [];
  const ids = file.conditions.flatMap((condition) => {
    if (condition.kind !== OVERLAY_KIND.FREEZE || condition.subject === undefined)
      return [];
    if (!agentFrozen([`${condition.kind}:${condition.subject}`], kind)) return [];
    const at = condition.id.indexOf(`:${AGENT_SUBJECT_PREFIX}`);
    return [at === -1 ? condition.id : condition.id.slice(0, at)];
  });
  return [...new Set(ids)];
}
