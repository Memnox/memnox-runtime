import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LeaseGate,
  LeaseRegistry,
  SHARED_OUTCOME,
  type LeaseHolder,
  type SharedLeases,
} from '@memnox/core';
import {
  claimEdit,
  EDIT_HOOK_WAIT_MS,
  editOf,
  SHORT_EDIT_WAIT_MS,
  withAddedContext,
} from '../src/edit-hook';
import { EDIT_HOST } from '../src/agent-edits';
import { editWaitFor } from '../src/edit-claims';
import { projectRootOf } from '../src/seam-runtime';
import { UNCONFIRMED_OPERATION, unconfirmedRow } from '../src/unconfirmed-write';
import type { SeamLeases } from '../src/seam-runtime';

const ROOT = '/work/repo';
const holder: LeaseHolder = { agent: 'claude-code', sessionId: 's1', pid: 101 };
const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'memnox-edit-wait-'));

const payload = {
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  cwd: ROOT,
  tool_name: 'Edit',
  tool_input: { file_path: `${ROOT}/src/billing/invoice.ts`, old_string: 'a' },
};

describe('an edit the workspace could not be asked about', () => {
  it('goes ahead, and the agent is told a collision was not ruled out', async () => {
    const unreachable: SharedLeases = {
      take: async () => ({
        outcome: SHARED_OUTCOME.UNKNOWN,
        because: 'the control plane did not answer',
        unanswered: true,
      }),
      release: async () => undefined,
      releaseSession: async () => undefined,
      renewSession: async () => undefined,
    };
    const leases: SeamLeases = {
      gate: new LeaseGate({
        registry: new LeaseRegistry(await home(), () => true),
        shared: unreachable,
        now: () => '2026-10-23T10:00:00.000Z',
      }),
      holder,
      repositoryRoot: ROOT,
      isDirectory: (path) => !path.includes('.'),
    };
    const edit = editOf(payload);
    if (edit === null) throw new Error('unread');

    const told: string[] = [];
    expect(await claimEdit(edit, leases, (said) => told.push(said))).toBeNull();
    expect(told).toEqual([
      'Could not check whether another machine is writing src/billing/invoice.ts, because the control plane did not answer. The write went ahead, but a collision with another machine was not ruled out.',
    ]);
  });

  it('is said in the context the model reads before the tool runs', () => {
    const alone = JSON.parse(withAddedContext(undefined, 'unchecked') ?? '') as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(alone.hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      additionalContext: 'unchecked',
    });

    const decided = JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'decided' },
    });
    const both = JSON.parse(withAddedContext(decided, 'unchecked') ?? '') as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(both.hookSpecificOutput.additionalContext).toBe('decided\n\nunchecked');
    // A reply in some other shape is left alone, and the caller says it on stderr.
    expect(withAddedContext('plain words', 'unchecked')).toBeNull();
  });

  it('is kept as a row, so the timeline shows the write went unchecked', () => {
    const row = unconfirmedRow({
      sessionId: 's1',
      agent: 'claude-code',
      path: '/work/repo/src/billing/invoice.ts',
      said: 'Could not check.',
      at: '2026-10-23T10:00:00.000Z',
    });
    expect(row).toMatchObject({
      operation: UNCONFIRMED_OPERATION,
      target: '/work/repo/src/billing/invoice.ts',
      effect: 'allow',
      reason: 'Could not check.',
    });
  });
});

describe('how long an edit waits', () => {
  it('waits long only where the host lets the hook run that long', () => {
    expect(editWaitFor(EDIT_HOST.PRE_TOOL_USE)).toBe(EDIT_HOOK_WAIT_MS);
    expect(editWaitFor(EDIT_HOST.GEMINI)).toBe(EDIT_HOOK_WAIT_MS);
    expect(editWaitFor(EDIT_HOST.WINDSURF)).toBe(SHORT_EDIT_WAIT_MS);
  });
});

describe('a project that is not a git checkout', () => {
  it('is the outermost folder with a project file, below home', async () => {
    const person = await home();
    const site = join(person, 'site');
    const pkg = join(site, 'packages', 'web');
    await mkdir(join(pkg, 'src'), { recursive: true });
    await writeFile(join(site, 'package.json'), '{}');
    await writeFile(join(pkg, 'package.json'), '{}');
    // A stray file in home itself must not make every folder one project.
    await writeFile(join(person, 'package.json'), '{}');

    expect(projectRootOf(join(pkg, 'src'), person)).toBe(site);
    expect(projectRootOf(person, person)).toBeNull();
    expect(projectRootOf(join(person, 'notes'), person)).toBeNull();
  });
});
