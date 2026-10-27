/** `memnox agents pause` and `memnox agents resume`: one agent held on this machine, the rest left working. */
import {
  agentNamed,
  pauseAgent,
  resumeAgent,
  stillHeldByWorkspace,
  type PauseSeams,
} from '../../agents/agent-pause';
import { WORKSPACE_TOLD, type ToldWorkspace } from '../../sync/agent-pause-cloud';
import type { AgentsDeps, JsonOptions } from './shared';

export interface PauseOptions extends JsonOptions {
  reason?: string;
}

function seamsOf(deps: AgentsDeps, overrides: Partial<PauseSeams>): PauseSeams {
  return { home: deps.home(), now: () => new Date(), ...overrides };
}

/** The kind a typed name means, or null once the refusal has been printed. */
async function kindFor(
  deps: AgentsDeps,
  typed: string,
  asJson: boolean,
): Promise<string | null> {
  const match = await agentNamed(deps.home(), typed);
  if ('kind' in match) return match.kind;
  const said =
    'ambiguous' in match
      ? `"${typed}" could be ${match.ambiguous.join(' or ')}. Name one of them.`
      : `No agent goes by "${typed}".`;
  if (asJson) deps.context.out.json({ ok: false, said });
  else deps.context.flow.close(said);
  process.exitCode = 1;
  return null;
}

export async function runPause(
  deps: AgentsDeps,
  typed: string,
  options: PauseOptions,
  overrides: Partial<PauseSeams> = {},
): Promise<void> {
  const asJson = options.json === true;
  if (!asJson) deps.context.flow.open('memnox agents pause');
  const kind = await kindFor(deps, typed, asJson);
  if (kind === null) return;
  const paused = await pauseAgent(seamsOf(deps, overrides), kind, options.reason);
  if (asJson) {
    deps.context.out.json({ ok: true, ...paused });
    return;
  }
  const { style, flow } = deps.context;
  flow.close(
    paused.fresh
      ? style.ok(
          `${kind} is paused here until ${paused.until}. ${told(paused.workspace)}`,
        )
      : `${kind} was already paused here. ${told(paused.workspace)}`,
  );
  flow.hint(`Let it carry on with "memnox agents resume ${kind}".`);
}

export async function runResumeAgent(
  deps: AgentsDeps,
  typed: string,
  options: JsonOptions,
  overrides: Partial<PauseSeams> = {},
): Promise<void> {
  const asJson = options.json === true;
  if (!asJson) deps.context.flow.open('memnox agents resume');
  const kind = await kindFor(deps, typed, asJson);
  if (kind === null) return;
  const resumed = await resumeAgent(seamsOf(deps, overrides), kind);
  const held = stillHeldByWorkspace(resumed);
  if (held) process.exitCode = 1;
  if (asJson) {
    deps.context.out.json({ ok: !held, ...resumed });
    return;
  }
  const { style, flow } = deps.context;
  if (held) {
    flow.close(
      `${kind} is resumed here, but the workspace still holds a freeze on it, so it stays stopped until that lifts.`,
    );
    return;
  }
  flow.close(
    resumed.liftedHere === 0 && resumed.workspace.length === 0
      ? `${kind} was not paused, so it was already working.`
      : style.ok(`${kind} carries on.`),
  );
}

function told(answer: ToldWorkspace): string {
  if (answer.outcome === WORKSPACE_TOLD.TOLD) return 'The workspace shows it paused too.';
  if (answer.outcome === WORKSPACE_TOLD.NO_WORKSPACE) return 'Only this machine knows.';
  if (answer.outcome === WORKSPACE_TOLD.REFUSED)
    return `The workspace did not take it (${answer.said ?? 'refused'}), though it is paused here.`;
  return 'The workspace could not be reached, though it is paused here.';
}
