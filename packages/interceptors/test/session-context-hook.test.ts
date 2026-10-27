import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTOR_TYPE,
  configPathFor,
  DECISION_EFFECT,
  DEFAULT_CONFIG,
  DEFAULT_NOTICE_SETTINGS,
  emptySeen,
  emptySignals,
  ENFORCEMENT_MODE,
  ENV_POLICIES,
  LocalGate,
  MOST_BOUNDARY_CHARS,
  MOST_DECISIONS_PER_CALL,
  MOST_FACTS_PER_CALL,
  writeWorkspaceMemory,
  WORK_BRIEF_VAR,
  WorkBriefs,
  MOST_CANDIDATES_PER_CALL,
  type WorkspaceFact,
  NOTICE_MODE,
  renderConfig,
  UnusualNotice,
  writePolicyDocumentFile,
  type EnforcementMode,
  type EventQuery,
  type EventSink,
  type MemnoxEvent,
  type NoticeStore,
  type Policy,
  type SeenSet,
  type SessionSignals,
  writeProtectionStop,
  watchedRepositories,
  watchListPath,
} from '@memnox/core';
import { HookAuthorizer } from '../src/hook-authorizer';
import {
  learnFromAnswer,
  rememberQuestion,
  toolFingerprint,
} from '../src/prompt-answers';
import {
  answerSessionStart,
  decisionsAt,
  preToolContext,
  sessionStartOf,
  type SessionContextDeps,
} from '../src/session-context-hook';
import { answerToolCall } from '../src/tool-hook';

/**
 * Memnox inside the session: the boundary once at its start, a remembered decision where
 * the agent meets it and never twice, and a yes given in the agent's own prompt learned
 * from the tool running, since the host says nothing else about it.
 */

const NOW = new Date('2026-09-24T10:00:00.000Z');

const RULES: Policy[] = [
  {
    name: 'secrets-deny',
    match: { actions: ['filesystem.read'], targets: ['**/.ssh/**', '**/.env'] },
    decision: { effect: DECISION_EFFECT.DENY, reason: 'keys stay on this machine' },
  },
  {
    name: 'payments-ask',
    match: { actions: ['filesystem.write'], targets: ['**/payments/**'] },
    decision: {
      effect: DECISION_EFFECT.ASK,
      reason: 'Priya decided payments are reviewed',
    },
  },
  {
    name: 'payments-read',
    match: { actions: ['filesystem.read'], targets: ['**/payments/**'] },
    decision: { effect: DECISION_EFFECT.ALLOW, reason: 'reading payments is fine' },
  },
  {
    name: 'network-ask',
    match: { actions: ['http.request'] },
    decision: { effect: DECISION_EFFECT.ASK, reason: 'a person looks at new hosts' },
  },
];

async function machine(
  mode: EnforcementMode = ENFORCEMENT_MODE.ENFORCE,
): Promise<SessionContextDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-in-session-'));
  const repo = join(home, 'work', 'repo');
  await mkdir(repo, { recursive: true });
  const rules = join(repo, 'memnox.policies.toml');
  await writePolicyDocumentFile(rules, { version: 1, policies: RULES });
  await mkdir(join(configPathFor(home), '..'), { recursive: true });
  await writeFile(configPathFor(home), renderConfig({ ...DEFAULT_CONFIG, mode }));
  return {
    home,
    agent: 'claude-code',
    env: { [ENV_POLICIES]: rules },
    cwd: repo,
    now: () => NOW,
    rootOf: () => repo,
  };
}

describe('the boundary, when a session starts', () => {
  it('is read from a SessionStart payload, which Claude Code, Codex and Gemini CLI share', () => {
    expect(
      sessionStartOf({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/r' }),
    ).toEqual({
      sessionId: 's1',
      cwd: '/r',
    });
    expect(
      sessionStartOf({ hook_event_name: 'SessionEnd', session_id: 's1' }),
    ).toBeNull();
  });

  it('is added context naming the mode, the rules here and the boundary, within its bound', async () => {
    const deps = await machine();
    const said = await answerSessionStart({ sessionId: 's1' }, deps);
    const reply = JSON.parse(said) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };

    expect(reply.hookSpecificOutput.hookEventName).toBe('SessionStart');
    const text = reply.hookSpecificOutput.additionalContext;
    expect(text).toContain('enforce mode');
    expect(text).toContain('keys stay on this machine');
    expect(text).toContain('Priya decided payments are reviewed');
    expect(text).toContain(`Project boundary: ${deps.cwd}`);
    expect(text.length).toBeLessThanOrEqual(MOST_BOUNDARY_CHARS);
  });

  it('hands a session started on a ticket its whole brief before the first turn', async () => {
    const base = await machine();
    await new WorkBriefs(base.home).write({
      id: 'wrk_abc123',
      about: 'Fix auth token refresh',
      at: NOW.toISOString(),
      sources: [
        {
          title: 'Fix auth token refresh',
          excerpt: 'Refresh before the call fails.',
          content: 'Refresh before the call fails. Acceptance: never log the token.',
          system: 'linear',
          at: '2026-09-20T09:00:00.000Z',
          link: 'https://linear.app/acme/issue/ENG-12',
        },
      ],
      decisions: [
        { statement: 'Refresh stays in the session client.', settled: 'a decision' },
      ],
      withheld: 0,
    });
    const deps = { ...base, env: { ...base.env, [WORK_BRIEF_VAR]: 'wrk_abc123' } };
    const text = (
      JSON.parse(await answerSessionStart({ sessionId: 's1' }, deps)) as {
        hookSpecificOutput: { additionalContext: string };
      }
    ).hookSpecificOutput.additionalContext;
    expect(text).toContain('Workspace brief wrk_abc123, for: Fix auth token refresh.');
    expect(text).toContain(
      '"Refresh before the call fails. Acceptance: never log the token."',
    );
    expect(text).toContain('its code fingerprint and the rules in force on this session');
    expect(text).toContain('Decision (a decision): Refresh stays in the session client.');
    expect(text).toContain('stop before you change anything and ask your person');

    const forged = { ...base, env: { ...base.env, [WORK_BRIEF_VAR]: '../../account' } };
    expect(await answerSessionStart({ sessionId: 's1' }, forged)).not.toContain(
      'Workspace brief',
    );
  });

  /* A stop turns every seam off, and a session that heard nothing would assume it was
     still being watched. */
  it('says protection is stopped, by whom, and how to turn it back on', async () => {
    const deps = await machine();
    await writeProtectionStop(deps.home, {
      at: '2026-09-24T09:00:00.000Z',
      by: 'maya',
      reason: 'demo',
      mode: ENFORCEMENT_MODE.ENFORCE,
    });

    const said = await answerSessionStart({ sessionId: 's1' }, deps);
    const text = (
      JSON.parse(said) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext;

    expect(text).toContain('stopped');
    expect(text).toContain('maya');
    expect(text).toContain('memnox start');
  });

  it('says nothing when Memnox is off', async () => {
    expect(
      await answerSessionStart({ sessionId: 's1' }, await machine(ENFORCEMENT_MODE.OFF)),
    ).toBe('');
  });
});

describe('a remembered decision, where the agent meets it', () => {
  it('is said once per session, and a few at most per call', async () => {
    const deps = await machine();
    const lookup = {
      sessionId: 's1',
      subjects: [
        { action: 'filesystem.read', target: `${deps.cwd}/src/payments/charge.ts` },
        { action: 'filesystem.write', target: `${deps.cwd}/src/payments/charge.ts` },
        { action: 'http.request', target: 'api.example.com' },
      ],
    };

    const first = await decisionsAt(lookup, deps);
    expect(first?.split('\n')).toHaveLength(MOST_DECISIONS_PER_CALL);
    expect(first).toContain('A previous decision covers');
    const second = await decisionsAt(lookup, deps);
    expect(second?.split('\n')).toHaveLength(1);
    expect(await decisionsAt(lookup, deps)).toBeNull();
    // Another session has been told nothing yet.
    expect(await decisionsAt({ ...lookup, sessionId: 's2' }, deps)).not.toBeNull();
  });

  it('is found in the words of a prompt, and never for a prompt naming nothing', async () => {
    const deps = await machine();
    const said = await decisionsAt(
      { sessionId: 's1', prompt: 'tidy up payments/ please' },
      deps,
    );
    expect(said).toContain('covers payments/');
    expect(
      await decisionsAt({ sessionId: 's1', prompt: 'what time is it' }, deps),
    ).toBeNull();
  });

  it("rides beside a tool call in Claude Code's words, which leave the prompt to run", () => {
    expect(JSON.parse(preToolContext('x'))).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'x' },
    });
  });
});

describe('what the workspace settled, where the agent meets it', () => {
  const settled = (id: string, over: Partial<WorkspaceFact> = {}): WorkspaceFact => ({
    id,
    kind: 'decision',
    statement: `Payments rule ${id}.`,
    subject: 'payments',
    verifiedBy: 'ada@acme.test',
    ...over,
  });

  async function connected(facts: WorkspaceFact[]): Promise<SessionContextDeps> {
    const deps = await machine();
    await writeWorkspaceMemory(deps.home, {
      hash: 'm1',
      facts,
      withheld: 0,
      syncedAt: NOW.toISOString(),
    });
    return deps;
  }

  it('is said before a write to what it is about, naming who confirmed it', async () => {
    const deps = await connected([settled('f1'), settled('f2', { subject: 'billing' })]);

    const said = await decisionsAt(
      {
        sessionId: 's1',
        subjects: [
          { action: 'filesystem.write', target: `${deps.cwd}/src/payments/charge.ts` },
        ],
      },
      deps,
    );

    expect(said).toContain('Your workspace settled this about payments');
    expect(said).toContain('confirmed by ada@acme.test');
    expect(said).not.toContain('billing');
  });

  it('is never said for a read, which has not decided anything yet', async () => {
    const deps = await connected([settled('f1')]);

    const said = await decisionsAt(
      {
        sessionId: 's1',
        subjects: [
          { action: 'filesystem.read', target: `${deps.cwd}/src/payments/charge.ts` },
        ],
      },
      deps,
    );

    expect(said ?? '').not.toContain('Your workspace');
  });

  it('is found in the words of a prompt, once per session and a few at most', async () => {
    const deps = await connected(
      Array.from({ length: MOST_FACTS_PER_CALL + 2 }, (_, at) => settled(`f${at}`)),
    );
    const lookup = { sessionId: 's1', prompt: 'why do payment refunds fail' };

    const first = await decisionsAt(lookup, deps);
    const facts = (text: string | null): string[] =>
      (text ?? '').split('\n').filter((line) => line.startsWith('Your workspace'));

    expect(facts(first)).toHaveLength(MOST_FACTS_PER_CALL);
    expect(facts(await decisionsAt(lookup, deps))).toHaveLength(2);
    expect(await decisionsAt(lookup, deps)).toBeNull();
  });

  it('says a candidate once, opening with that nobody approved it, and never as settled', async () => {
    const deps = await machine();
    await writeWorkspaceMemory(deps.home, {
      hash: 'm1',
      facts: [settled('f1')],
      unconfirmed: [
        {
          id: 'c1',
          kind: 'decision',
          statement: 'Payment refunds go through the queue now.',
          subject: 'payments',
          standing: 'candidate',
          approved: false,
          sources: ['linear'],
        },
        {
          id: 'c2',
          kind: 'decision',
          statement: 'Payment refunds are capped at fifty.',
          subject: 'payments',
          standing: 'candidate',
          approved: false,
          sources: ['slack'],
        },
      ],
      withheld: 0,
      syncedAt: NOW.toISOString(),
    });
    const lookup = { sessionId: 's1', prompt: 'why do payment refunds fail' };

    const lines = ((await decisionsAt(lookup, deps)) ?? '').split('\n');
    const guesses = lines.filter((line) => line.startsWith('Not approved by anyone'));

    expect(guesses).toHaveLength(MOST_CANDIDATES_PER_CALL);
    expect(guesses[0]).toContain('Context only');
    expect(
      lines.filter(
        (line) => line.includes('Payment refunds') && line.startsWith('Your workspace'),
      ),
    ).toEqual([]);
  });

  it('tells the agent at session start to ask before it changes code', async () => {
    const deps = await connected([settled('f1')]);

    const said = await answerSessionStart({ sessionId: 's1' }, deps);
    const text = (
      JSON.parse(said) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext;

    expect(text).toContain('Your workspace has settled 1 decision(s)');
    expect(text).toContain('"brief"');
  });

  it('says nothing about a workspace when this machine never pulled one', async () => {
    const deps = await machine();
    const said = await answerSessionStart({ sessionId: 's1' }, deps);

    expect(said).not.toContain('Your workspace');
  });
});

/* The repository's own conventions, told before the agent writes any code, so the first
   refusal is not how it learns them. */
describe("the repository's code fingerprint, when a session starts", () => {
  it('is told once, with what is enforced named as such', async () => {
    const deps = await machine();
    await mkdir(join(deps.cwd, '.memnox'), { recursive: true });
    await writeFile(
      join(deps.cwd, '.memnox', 'code-fingerprint.yaml'),
      [
        'naming:',
        '  files: kebab-case',
        'enforce:',
        '  - name: no-console',
        '    files: ["src/**"]',
        '    forbid: ["*console.*"]',
        '    reason: use the logger',
      ].join('\n'),
    );

    const said = await answerSessionStart({ sessionId: 's1' }, deps);
    const text = (
      JSON.parse(said) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext;

    expect(text).toContain('- naming.files: kebab-case');
    expect(text).toContain('- enforced: use the logger (src/**)');
    expect((JSON.parse(said) as { systemMessage?: string }).systemMessage).toContain(
      '1 check(s)',
    );
  });

  it('asks the agent to record one, once, where the repository states none', async () => {
    const said = await answerSessionStart({ sessionId: 's1' }, await machine());
    const text = (
      JSON.parse(said) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext;

    expect(text).toContain('does not yet state how its code is written');
    expect(text).toContain('"fingerprint" tool');
  });

  // Cursor has a session start of its own and reads its own shape back.
  it('answers Cursor with the same context, in the shape Cursor reads', async () => {
    const start = sessionStartOf({
      hook_event_name: 'sessionStart',
      session_id: 'c1',
    });
    if (start === null) throw new Error('not read as a session start');

    const said = JSON.parse(await answerSessionStart(start, await machine())) as {
      additional_context?: string;
      hookSpecificOutput?: unknown;
    };

    expect(said.additional_context).toContain(
      'does not yet state how its code is written',
    );
    expect(said.hookSpecificOutput).toBeUndefined();
  });

  it('names the command each agent types, which Codex files under prompts:', async () => {
    const deps = { ...(await machine()), agent: 'codex-cli' };
    const said = await answerSessionStart({ sessionId: 's1' }, deps);

    expect((JSON.parse(said) as { systemMessage?: string }).systemMessage).toContain(
      '/prompts:fingerprint',
    );
  });

  // What only the agent is told looks like nothing to its person, so they are told as well.
  it('tells the person too, with what to ask for', async () => {
    const said = await answerSessionStart({ sessionId: 's1' }, await machine());

    expect((JSON.parse(said) as { systemMessage?: string }).systemMessage).toContain(
      'no code fingerprint yet',
    );
  });
});

/* A repository is picked up the first time an agent works in it, wherever setup ran, so
   the daemon puts its MCP servers behind the proxy before the next session starts them. */
describe('the repository, when a session starts', () => {
  it('is added to what the daemon watches', async () => {
    const deps = await machine();
    await mkdir(join(deps.cwd, '.git'), { recursive: true });
    expect(watchedRepositories(deps.home)).toEqual([]);

    await answerSessionStart({ sessionId: 's1' }, deps);

    expect(watchedRepositories(deps.home)).toEqual([deps.cwd]);
  });

  it('gives the daemon a list to watch before any session has written one', async () => {
    const deps = await machine();

    const path = watchListPath(deps.home);

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([]);
  });
});

class Rows implements EventSink {
  readonly appended: MemnoxEvent[] = [];
  async append(event: MemnoxEvent): Promise<void> {
    this.appended.push(event);
  }
  async query(_filter: EventQuery): Promise<MemnoxEvent[]> {
    return this.appended;
  }
}

class MemoryNotice implements NoticeStore {
  seen: SeenSet = emptySeen();
  writes = 0;
  readSeen(): SeenSet {
    return this.seen;
  }
  writeSeen(_agent: string, seen: SeenSet): void {
    this.seen = seen;
    this.writes += 1;
  }
  readSignals(): SessionSignals {
    return emptySignals();
  }
  writeSignals(): void {}
  startedAt(): string {
    return '2026-01-01T00:00:00.000Z';
  }
}

function noticingAuthorizer(store: MemoryNotice): HookAuthorizer {
  const gate = new LocalGate(RULES, { agentName: 'claude-code' });
  gate.attachNotice(
    new UnusualNotice({
      store,
      agent: 'claude-code',
      settings: { ...DEFAULT_NOTICE_SETTINGS, mode: NOTICE_MODE.ENFORCE },
      now: () => NOW,
    }),
  );
  return new HookAuthorizer({ gate });
}

function fetchCall(event: string, id = 'toolu_1'): Record<string, unknown> {
  return {
    hook_event_name: event,
    session_id: 's1',
    cwd: '/work/repo',
    permission_mode: 'default',
    tool_name: 'WebFetch',
    tool_use_id: id,
    tool_input: { url: 'https://api.example.com/v1' },
  };
}

async function askedAbout(deps: SessionContextDeps, id = 'toolu_1'): Promise<void> {
  const before = fetchCall('PreToolUse', id);
  const answer = await answerToolCall(
    before,
    { ...deps, runSession: undefined, personThere: true },
    {
      authorizer: noticingAuthorizer(new MemoryNotice()),
      mode: ENFORCEMENT_MODE.ENFORCE,
      sink: null,
    },
  );
  expect(answer?.asked).toBe(true);
  await rememberQuestion(before, answer!, { ...deps, runSession: undefined });
}

describe("a yes given in the agent's own prompt", () => {
  it('is recorded as the person allowing it, and teaches noticing the same new thing', async () => {
    const deps = await machine();
    await askedAbout(deps);
    const rows = new Rows();
    const notice = new MemoryNotice();

    const learned = await learnFromAnswer(fetchCall('PostToolUse'), {
      ...deps,
      runSession: undefined,
      sink: rows,
      authorizer: noticingAuthorizer(notice),
      mode: ENFORCEMENT_MODE.ENFORCE,
      person: () => 'dana',
    });

    expect(learned).toBe(true);
    expect(rows.appended).toHaveLength(1);
    expect(rows.appended[0]).toMatchObject({
      actorType: ACTOR_TYPE.HUMAN,
      effect: DECISION_EFFECT.ALLOW,
      operation: 'http.request',
      authorizedBy: 'dana (claude-code prompt)',
      sessionId: 's1',
    });
    expect(notice.writes).toBe(1);
    // Answered once: the same call returning again is not a second yes.
    expect(
      await learnFromAnswer(fetchCall('PostToolUse'), {
        ...deps,
        runSession: undefined,
        sink: rows,
      }),
    ).toBe(false);
  });

  it('leaves nothing for a tool that never ran, or one returning after the window', async () => {
    const deps = await machine();
    await askedAbout(deps);
    const rows = new Rows();

    // A different call returning is not the one asked about.
    expect(
      await learnFromAnswer(fetchCall('PostToolUse', 'toolu_other'), {
        ...deps,
        runSession: undefined,
        sink: rows,
      }),
    ).toBe(false);
    const late = {
      ...deps,
      runSession: undefined,
      sink: rows,
      now: () => new Date('2026-09-24T12:00:00.000Z'),
    };
    expect(await learnFromAnswer(fetchCall('PostToolUse'), late)).toBe(false);
    expect(rows.appended).toEqual([]);
  });

  it('fingerprints by the host id, or by the tool and its input where there is none', () => {
    expect(toolFingerprint(fetchCall('PreToolUse'))).toBe('toolu_1');
    const bare = { tool_name: 'Bash', tool_input: { command: 'ls', b: 1 } };
    const reordered = { tool_name: 'Bash', tool_input: { b: 1, command: 'ls' } };
    expect(toolFingerprint(bare)).toBe(toolFingerprint(reordered));
    expect(toolFingerprint('nope')).toBeNull();
  });
});
