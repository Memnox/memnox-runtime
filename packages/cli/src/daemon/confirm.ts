import { basename, isAbsolute } from 'node:path';
import {
  driveCovers,
  SessionPauses,
  HOLD_ANSWER,
  Milestones,
  NodeGit,
  NodeWorktree,
  PendingApprovals,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  proposalCapability,
  readAccount,
  REMOTE_CAPABILITY,
  RULE_SCOPE,
  type DaemonEvent,
  type DeviceRecord,
  type HoldAnswer,
  type HoldRequest,
  type Policy,
  type Proposal,
  type RuleScope,
} from '@memnox/core';
import { machinePolicyPath } from '../protect/machine-rules';
import { mergeRules, WRITTEN_POLICY_FILE } from '../protect/merge-rules';
import { fileForScope, scopeAnswered, scopedRules } from '../protect/rule-scope';
import { decisionsOfRules, recordLocalDecisions } from '../sync/local-decisions';
import { editedProposal, ranOf } from './confirm-edit';
import { applyPersonal } from './confirm-work';
import {
  FROM_NOW_ON,
  NEVER_FROM_NOW_ON,
  proposeFromNowOn,
  proposeNeverFromNowOn,
} from './from-now-on';
import { registerPolicyFile } from '../policy-registry';
import { recordAnswer } from './record-answer';
import { consentFor, type Needs } from './confirm-consent';
import {
  commandResults,
  runMemnox,
  runsInBackground,
  VOICE_RUN,
  voiceArguments,
  type CommandRun,
} from '../session-tools/voice-commands';

/**
 * A person's answer arriving from the Mac app or a paired phone. Refusing never needs proof; a yes
 * carries a signature from a trusted device, unless the Mac allows a call that stays inside its session.
 */

/** The device a remote answer arrives from, as its handshake proved it, and whether it drives the Mac now. */
export interface RemotePrincipal {
  device: DeviceRecord;
  driving: boolean;
}

export interface ConfirmInput {
  subject: string;
  answer: string;
  signature?: string;
  /** The words the person rewrote on a draft card, which the signature covers and which go out instead. */
  edited?: string;
  /** The addresses the person typed on a mail's card, joined by commas, which the signature covers with the words. */
  editedTo?: string;
  /** What the person said with a no, which the agent hears beside the rule's way forward; a yes drops it. */
  reason?: string;
  at: string;
  /** How a confirmed memnox command is run; memnox itself unless a test hands in another. */
  run?: CommandRunner;
  /** Absent on the local socket. A phone's yes is always signed, since a tap proves nobody is at the Mac. */
  principal?: RemotePrincipal;
}

/** A confirmed command still running on its own, such as a login waiting on its browser page. */
const STARTED = 'started';

/** A spoken rule signed on an enrolled machine, which holds here at once and waits on the team. */
const OFFERED_TOO = `${PROPOSAL_ANSWER.CONFIRMED}: in force on this machine, and offered to the team, where a second admin approves it`;

/** A held call let through: allowed, and still the agent's to run, so the Mac never calls it done. */
const LET_THROUGH = 'let-through';

/** A Mac proposal confirmed hands back what to show on the Mac and which device asked for it. */
export type ConfirmResult =
  | { ok: true; outcome: string; release?: { event: DaemonEvent; deviceId: string } }
  | { ok: false; error: string; refused?: true };

const PENDING_PREFIX = 'apr_';
const PROPOSAL_PREFIX = 'prp_';

/** What a voice may answer a held call with. Editing a command needs a keyboard. */
const SPOKEN_HOLD_ANSWERS: readonly string[] = [
  HOLD_ANSWER.ONCE,
  HOLD_ANSWER.SESSION,
  HOLD_ANSWER.DENY,
];

/** This call once or refused once, as said by an answer that also puts a rule card up for the next one. */
function heldAnswerOf(said: string): HoldAnswer | null {
  if (said === FROM_NOW_ON) return HOLD_ANSWER.ONCE;
  if (said === NEVER_FROM_NOW_ON) return HOLD_ANSWER.DENY;
  return SPOKEN_HOLD_ANSWERS.includes(said) ? (said as HoldAnswer) : null;
}

export async function confirmAnswer(
  home: string,
  input: ConfirmInput,
): Promise<ConfirmResult> {
  if (input.subject.startsWith(PENDING_PREFIX)) return answerHeld(home, input);
  if (input.subject.startsWith(PROPOSAL_PREFIX)) return answerProposal(home, input);
  return { ok: false, error: `${input.subject} is neither a held call nor a proposal` };
}

async function answerHeld(home: string, input: ConfirmInput): Promise<ConfirmResult> {
  // This call runs once or is refused; what settles the next one is a rule the person places and signs.
  const answer = heldAnswerOf(input.answer);
  if (answer === null) {
    return { ok: false, error: `"${input.answer}" is not an answer a held call takes` };
  }
  const approvals = new PendingApprovals(home);
  const held = await approvals.read(input.subject);
  const consent = await consentFor(home, input, {
    refusing: answer === HOLD_ANSWER.DENY,
    capability: REMOTE_CAPABILITY.ANSWER,
    withinSession: held?.request.withinSession === true,
    driven: false,
  });
  if ('refused' in consent) return { ok: false, error: consent.refused, refused: true };
  const by = consent.by;
  const outcome = await approvals.answer(
    input.subject,
    answer,
    by,
    input.at,
    input.reason,
  );
  if (outcome === null || held === null)
    return { ok: false, error: `${input.subject} is no longer held` };
  if ('alreadyAnswered' in outcome) {
    return {
      ok: true,
      outcome: `already answered ${outcome.alreadyAnswered.answer ?? ''}`,
    };
  }
  await recordAnswer(home, { request: held.request, answer, by, at: input.at });
  return offerNextTime(home, input, {
    request: held.request,
    answer,
    reason: outcome.answered.answerReason,
  });
}

/** The rule card a from now on answer puts up for the next call like this one. */
async function offerNextTime(
  home: string,
  input: ConfirmInput,
  held: { request: HoldRequest; answer: HoldAnswer; reason: string | undefined },
): Promise<ConfirmResult> {
  if (input.answer === NEVER_FROM_NOW_ON) {
    const offered = await proposeNeverFromNowOn(
      home,
      held.request,
      input.at,
      held.reason,
    );
    return { ok: true, outcome: fromNowOnOutcome(held.answer, offered) };
  }
  if (input.answer !== FROM_NOW_ON) return { ok: true, outcome: held.answer };
  const offered = await proposeFromNowOn(home, held.request, input.at);
  return { ok: true, outcome: fromNowOnOutcome(held.answer, offered) };
}

function fromNowOnOutcome(
  answer: HoldAnswer,
  offered: { proposed: string } | { notProposed: string },
): string {
  return 'proposed' in offered
    ? `${answer}, and the rule for from now on waits on the Mac as ${offered.proposed}`
    : `${answer}, and nothing from now on: ${offered.notProposed}`;
}

/** A rule's answer may be the place the person picked, which the signature then covers. */
function scopeOf(found: Proposal | null, answer: string): RuleScope | undefined {
  return found?.change.kind === PROPOSAL_KIND.RULES && found.change.scopes !== undefined
    ? scopeAnswered(found.change.scopes, answer)
    : undefined;
}

async function answerProposal(home: string, input: ConfirmInput): Promise<ConfirmResult> {
  const proposals = new Proposals(home);
  const found = await proposals.read(input.subject);
  const scope = scopeOf(found, input.answer);
  const answers: readonly string[] = Object.values(PROPOSAL_ANSWER);
  if (!answers.includes(input.answer) && scope === undefined) {
    return { ok: false, error: `"${input.answer}" is not an answer a proposal takes` };
  }
  const confirming = input.answer !== PROPOSAL_ANSWER.DECLINED;
  const answer = confirming ? PROPOSAL_ANSWER.CONFIRMED : PROPOSAL_ANSWER.DECLINED;
  const consent = await consentFor(home, input, await proposalNeeds(home, input, found));
  if ('refused' in consent) return { ok: false, error: consent.refused, refused: true };
  if (found === null) return { ok: false, error: `${input.subject} was never proposed` };
  const edited = confirming ? editedProposal(found, input.edited, input.editedTo) : found;
  if (edited === null)
    return { ok: false, error: `${input.subject} cannot be rewritten so` };
  // Checked before it is marked, so a proposal aimed at another file is refused rather than half done.
  if (confirming && !writesOnlyAPolicyFile(home, found, scope)) {
    return {
      ok: false,
      error: `${input.subject} names a file that is not a policy file`,
    };
  }
  const outcome = await proposals.answer(input.subject, answer, consent.by, input.at);
  if (outcome === null)
    return { ok: false, error: `${input.subject} was never proposed` };
  if ('alreadyAnswered' in outcome) {
    return {
      ok: true,
      outcome: `already ${outcome.alreadyAnswered.answer ?? 'answered'}`,
    };
  }
  if ('expired' in outcome) return { ok: false, error: `${input.subject} has expired` };
  if (!confirming) return { ok: true, outcome: answer };
  const carried = { ...outcome.answered, change: edited.change };
  return carryOut(home, carried, input, { proposals, by: consent.by, scope });
}

/**
 * A confirmed proposal carried out. Work in their name is the one kind whose outcome lives outside this Mac, so
 * what it came to is written beside the answer either way, for the voice to say whether it went.
 */
async function carryOut(
  home: string,
  proposal: Proposal,
  input: ConfirmInput,
  {
    proposals,
    by,
    scope,
  }: { proposals: Proposals; by: string; scope: RuleScope | undefined },
): Promise<ConfirmResult> {
  const run = input.run ?? runMemnox;
  const applied = await apply(home, proposal, { at: input.at, run, by, scope });
  const kind = proposal.change.kind;
  if (kind !== PROPOSAL_KIND.WORK && kind !== PROPOSAL_KIND.ACCOUNT) return applied;
  await proposals.ran(proposal.id, ranOf(proposal.change, applied, input.at));
  return applied;
}

/** What answering this proposal takes: the capability, and whether the session or a drive excuses a signature. */
async function proposalNeeds(
  home: string,
  input: ConfirmInput,
  found: Proposal | null,
): Promise<Needs> {
  const principal = input.principal;
  return {
    // A no to a team's question is a refusal too, so it is never held up by a signature.
    refusing:
      input.answer === PROPOSAL_ANSWER.DECLINED ||
      (found?.change.kind === PROPOSAL_KIND.TEAM &&
        found.change.answer === HOLD_ANSWER.DENY),
    capability: found === null ? null : proposalCapability(found.change),
    withinSession: await answersWithinSession(home, found),
    driven:
      principal !== undefined &&
      principal.driving &&
      found !== null &&
      driveCovers(found.change, principal.device.id),
  };
}

/** When it was confirmed, how a command runs, who said yes, and where a rule goes, which only a rule uses. */
interface Applying {
  at: string;
  run: CommandRunner;
  by: string;
  scope?: RuleScope;
}

async function apply(
  home: string,
  proposal: Proposal,
  { at, run, by, scope }: Applying,
): Promise<ConfirmResult> {
  const change = proposal.change;
  if (change.kind === PROPOSAL_KIND.RULES && scope?.kind === RULE_SCOPE.TEAM) {
    return offerToTeam(home, change.rules, at);
  }
  if (change.kind === PROPOSAL_KIND.RULES) {
    // A repository's rule is narrowed to its folder, since every registered file is loaded for every agent.
    const file = scope === undefined ? change.file : fileForScope(home, scope);
    const rules = scope === undefined ? change.rules : scopedRules(change.rules, scope);
    await mergeRules(file, rules, home);
    // Every seam loads only registered files, so a rule written anywhere else would be in force nowhere.
    await registerPolicyFile(home, file);
    if (change.offerTeam !== true || scope?.kind === RULE_SCOPE.REPOSITORY)
      return { ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED };
    // The rule as said, never narrowed to a folder here, since a team rule holds on every machine.
    const offered = await recordLocalDecisions(home, decisionsOfRules(change.rules, at));
    return { ok: true, outcome: offered === 0 ? PROPOSAL_ANSWER.CONFIRMED : OFFERED_TOO };
  }
  if (change.kind === PROPOSAL_KIND.RESUME) {
    const lifted = await new SessionPauses(home).resume(change.sessionId, by, at);
    return lifted === null
      ? { ok: false, error: `${change.sessionId} is not paused` }
      : { ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED };
  }
  if (change.kind === PROPOSAL_KIND.REWIND) return applyRewind(change, at);
  if (change.kind === PROPOSAL_KIND.COMMAND) {
    return applyCommand(home, { id: proposal.id, argv: change.argv, at }, run);
  }
  if (change.kind === PROPOSAL_KIND.MAC) {
    const release = { event: change.event, deviceId: change.deviceId };
    return { ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED, release };
  }
  // The device answered the workspace itself, signed where it was a yes, so nothing is done here.
  if (change.kind === PROPOSAL_KIND.TEAM)
    return { ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED };
  if (change.kind === PROPOSAL_KIND.ANSWER) {
    return applyHeldAnswer(home, proposal, change, { at, by });
  }
  return (
    (await applyPersonal(home, proposal)) ?? {
      ok: false,
      error: `${proposal.id} is nothing to apply`,
    }
  );
}

/**
 * A rule picked for the team is written to no file here: it is offered on the next sync,
 * where the control plane proposes it with this machine's owner as the decider and a second
 * admin approves it. Only then does it hold, for every agent the workspace runs.
 */
async function offerToTeam(
  home: string,
  rules: readonly Policy[],
  at: string,
): Promise<ConfirmResult> {
  const decided = decisionsOfRules(rules, at);
  if ((await readAccount(home)) === null) {
    return {
      ok: false,
      error: 'this Mac is not connected to a team, so there is nobody to offer it to',
    };
  }
  await recordLocalDecisions(home, decided);
  return {
    ok: true,
    outcome: `${PROPOSAL_ANSWER.CONFIRMED}: offered to the team, where a second admin approves it`,
  };
}

/** The tree put back once the person signed for it; the tree as it was is kept first, so it can come back. */
async function applyRewind(
  change: { repository: string; milestone: string },
  at: string,
): Promise<ConfirmResult> {
  const milestones = new Milestones(
    new NodeGit(change.repository),
    new NodeWorktree(change.repository),
  );
  try {
    const { restored, kept } = await milestones.restore(change.milestone, at);
    return {
      ok: true,
      outcome: `${PROPOSAL_ANSWER.CONFIRMED}: back to ${restored.id}, the work before it kept as ${kept.id}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A held call let through once the person said yes, and the row that says who and in what words. */
async function applyHeldAnswer(
  home: string,
  proposal: Proposal,
  change: { pendingId: string; answer: HoldAnswer },
  { at, by }: { at: string; by: string },
): Promise<ConfirmResult> {
  const approvals = new PendingApprovals(home);
  const held = await approvals.read(change.pendingId);
  const outcome = await approvals.answer(change.pendingId, change.answer, by, at);
  if (outcome === null || held === null)
    return { ok: false, error: `${change.pendingId} is no longer held` };
  if ('answered' in outcome) {
    await recordAnswer(home, {
      request: held.request,
      answer: change.answer,
      by,
      ...(proposal.said === undefined ? {} : { said: proposal.said }),
      at,
    });
  }
  return { ok: true, outcome: LET_THROUGH };
}

type CommandRunner = (argv: readonly string[], timeoutMs: number) => Promise<CommandRun>;

/** Long enough for an update or a protect to finish, never a command left hanging. */
const COMMAND_TIMEOUT_MS = 120_000;
/** As long as an enrolment code is good for, since the wait is the person in the browser. */
const BACKGROUND_TIMEOUT_MS = 15 * 60 * 1_000;

/**
 * A memnox command the person signed for, run here and kept for the voice to read back. Checked
 * again against what a voice may run, so a proposal written by hand cannot run what the voice never may.
 */
async function applyCommand(
  home: string,
  signed: { id: string; argv: readonly string[]; at: string },
  run: CommandRunner,
): Promise<ConfirmResult> {
  const { id, argv, at } = signed;
  const command = voiceArguments(argv);
  const results = commandResults(home);
  if (command === null || command.run === VOICE_RUN.NEVER) {
    const error = `memnox ${argv[0] ?? ''} is not something a voice may run`;
    // Kept as its result, so the voice says it failed rather than that it is still waiting.
    await results.write(id, { exitCode: 1, output: error, argv: [...argv], at });
    return { ok: false, error };
  }
  if (runsInBackground(command.argv)) {
    await results.write(id, {
      exitCode: 0,
      output: '',
      argv: command.argv,
      at,
      running: true,
    });
    // Not awaited: the confirmation ends now and the notice watcher tells the person when it does.
    void run(command.argv, BACKGROUND_TIMEOUT_MS).then((ran) =>
      results.write(id, {
        ...ran,
        argv: command.argv,
        at,
        doneAt: new Date().toISOString(),
      }),
    );
    // Started rather than done, so the Mac never says it is done while a browser page still waits.
    return { ok: true, outcome: STARTED };
  }
  const ran = await run(command.argv, COMMAND_TIMEOUT_MS);
  await results.write(id, { ...ran, argv: command.argv, at });
  return ran.exitCode === 0
    ? { ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED }
    : { ok: false, error: `memnox ${argv[0] ?? ''} ended with exit ${ran.exitCode}` };
}

/**
 * A model wrote the path, so a confirmed proposal may only ever touch a rule file: a repository's
 * own, by full path, or the machine's, at exactly the one place it lives.
 */
function writesOnlyAPolicyFile(
  home: string,
  proposal: Proposal,
  scope?: RuleScope,
): boolean {
  if (proposal.change.kind !== PROPOSAL_KIND.RULES) return true;
  const file = scope === undefined ? proposal.change.file : fileForScope(home, scope);
  if (file === machinePolicyPath(home)) return true;
  // Relative to where the daemon runs would be a file nobody meant, so only a full path is written.
  return isAbsolute(file) && basename(file) === WRITTEN_POLICY_FILE;
}

/** Only a yes to a held call, and only one that stays in its repository, goes without a fingerprint. */
async function answersWithinSession(
  home: string,
  found: Proposal | null,
): Promise<boolean> {
  if (found?.change.kind !== PROPOSAL_KIND.ANSWER) return false;
  const held = await new PendingApprovals(home).read(found.change.pendingId);
  return held?.request.withinSession === true;
}
