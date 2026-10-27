/**
 * Taking and restoring working trees. Every git call is read-only or writes into
 * `refs/memnox/`, except the restore, which first takes a milestone of what it replaces.
 */
import {
  decodeMessage,
  encodeMessage,
  idFromRef,
  milestoneIdFor,
  MILESTONE_KEEP,
  MILESTONE_REASON,
  MILESTONE_REF_PREFIX,
  milestonesToForget,
  refFor,
  type FileChange,
  type Milestone,
  type MilestoneReason,
} from './milestone';
import { REWIND_REFUSAL, RewindRefused, type GitPort, type WorktreePort } from './ports';

/**
 * Who signs a milestone commit. It is Memnox's own object under `refs/memnox/`, never in the
 * person's history, and git refuses `commit-tree` outright on a machine with no identity set.
 */
const MILESTONE_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: 'Memnox',
  GIT_AUTHOR_EMAIL: 'milestone@memnox.invalid',
  GIT_COMMITTER_NAME: 'Memnox',
  GIT_COMMITTER_EMAIL: 'milestone@memnox.invalid',
};

/** An ignored file bigger than this is build output or data, never something to put back. */
const MOST_IGNORED_BYTES = 1024 * 1024;

/** Enough for a repository's local config and keys, and a bound on a stray listing. */
const MOST_IGNORED_FILES = 200;

/**
 * Never put into a milestone, ignored or not: a milestone is a git object, and git
 * objects are copied, backed up and pushed with everything else in the repository.
 */
const SECRET_SHAPES: readonly string[] = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.kdbx',
  '*keyring*',
  '*secret*',
  '*credential*',
  'id_rsa*',
  'id_ecdsa*',
  'id_ed25519*',
  '.npmrc',
  '.netrc',
  '.pypirc',
];

/** The same shapes as git pathspecs, at any depth and in any case, for `git add -A`. */
const SECRET_PATHSPECS: readonly string[] = SECRET_SHAPES.map(
  (shape) => `:(exclude,glob,icase)**/${shape}`,
);

/** Whether a path's own name has a secret's shape. */
export function looksSecret(path: string): boolean {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  return SECRET_SHAPES.some((shape) => globRegex(shape).test(name));
}

function globRegex(shape: string): RegExp {
  const body = shape
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}$`);
}

/** A scratch index, so `git add -A` never touches the one the person is staging into. */
const SCRATCH_INDEX = '.git/memnox-index';

/** Counts scratch indexes this process made, so each operation's is its own. */
let scratchCount = 0;

/** The index the person stages into, only ever read from. */
const PERSON_INDEX = '.git/index';

const IN_PROGRESS: readonly [string, string][] = [
  ['MERGE_HEAD', 'a merge'],
  ['REBASE_HEAD', 'a rebase'],
  ['rebase-merge', 'a rebase'],
  ['rebase-apply', 'a rebase'],
  ['CHERRY_PICK_HEAD', 'a cherry-pick'],
  ['REVERT_HEAD', 'a revert'],
  ['BISECT_LOG', 'a bisect'],
];

export interface TakeMilestone {
  at: string;
  reason?: MilestoneReason;
  sessionId?: string;
  agent?: string;
  note?: string;
}

export interface RestoreResult {
  restored: Milestone;
  /** The milestone taken of what the restore replaced, so the rewind can itself be undone. */
  kept: Milestone;
}

type ScratchEnv = Record<string, string>;

/**
 * Its own scratch index per operation: a shared one let two reads at once, or one killed
 * midway, leave a lock that made every later comparison in that repository fail unseen.
 */
function scratchEnv(root: string): ScratchEnv {
  scratchCount += 1;
  return { GIT_INDEX_FILE: `${root}/${SCRATCH_INDEX}-${process.pid}-${scratchCount}` };
}

function indexOf(env: ScratchEnv): string {
  return env['GIT_INDEX_FILE'] ?? '';
}

function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

export class Milestones {
  constructor(
    private readonly git: GitPort,
    private readonly tree: WorktreePort,
  ) {}

  /**
   * The working tree as it is right now, including files git has never seen but not the
   * ones it ignores, because restoring somebody's `node_modules` would help nobody.
   */
  async take(request: TakeMilestone): Promise<Milestone> {
    const root = await this.repositoryRoot();
    const { tree, files } = await this.writeWorkingTree(root);
    const record = {
      takenAt: request.at,
      reason: request.reason ?? MILESTONE_REASON.MANUAL,
      files,
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      ...(request.agent === undefined ? {} : { agent: request.agent }),
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    const parent = await this.head();
    const commit = await this.git.run(
      [
        'commit-tree',
        tree,
        ...(parent === null ? [] : ['-p', parent]),
        '-m',
        encodeMessage(record),
      ],
      MILESTONE_IDENTITY,
    );

    const id = milestoneIdFor(request.at, commit);
    await this.git.run(['update-ref', refFor(id), commit]);
    return { id, commit, ...record };
  }

  /** The tree object for the working tree, built in the scratch index, and its file count. */
  private async writeWorkingTree(root: string): Promise<{ tree: string; files: number }> {
    const env = scratchEnv(root);
    try {
      await this.seedIndex(root, env);
      await this.git.run(['add', '-A', '--', '.', ...SECRET_PATHSPECS], env);
      const kept = await this.smallIgnored(root);
      // Forced, since they are ignored; only here, never into the person's own index.
      if (kept.length > 0) await this.git.run(['add', '-f', '--', ...kept], env);
      const tree = await this.git.run(['write-tree'], env);
      const files = nonEmptyLines(
        await this.git.run(['ls-files', '--', '.'], env),
      ).length;
      return { tree, files };
    } finally {
      await this.dropIndex(env);
    }
  }

  /** The operation's scratch index and any lock git left on it, since nothing reads either again. */
  private async dropIndex(env: ScratchEnv): Promise<void> {
    await this.tree.remove(indexOf(env));
    await this.tree.remove(`${indexOf(env)}.lock`);
  }

  /**
   * Ignored files worth putting back: local config the agent could wreck, but never a
   * secret. A wholly ignored directory, `node_modules` or `dist`, is one entry and skipped.
   */
  private async smallIgnored(root: string): Promise<string[]> {
    const size = this.tree.size;
    if (size === undefined) return [];
    const listing = await this.git
      .run(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'])
      .catch(() => '');
    const kept: string[] = [];
    for (const path of nonEmptyLines(listing)) {
      if (path.endsWith('/') || kept.length >= MOST_IGNORED_FILES) continue;
      if (looksSecret(path)) continue;
      const bytes = await size.call(this.tree, `${root}/${path}`);
      if (bytes !== null && bytes <= MOST_IGNORED_BYTES) kept.push(path);
    }
    return kept;
  }

  /**
   * A copy of the person's own index, whose file stamps let `add -A` skip every unchanged
   * file; a hook waits on this, and rehashing a large tree cost it a third of a second.
   */
  private async seedIndex(root: string, env: ScratchEnv): Promise<void> {
    const copied =
      this.tree.copy !== undefined &&
      (await this.tree.copy(`${root}/${PERSON_INDEX}`, indexOf(env)));
    if (copied) return;
    // Seed from HEAD so the tree is a delta and not a fresh copy of the repository.
    await this.git.run(['read-tree', 'HEAD'], env).catch(async () => {
      // A repository with no commits yet has no HEAD to read; start from nothing.
      await this.git.run(['read-tree', '--empty'], env);
    });
  }

  async list(): Promise<Milestone[]> {
    // Checked first: a raw "fatal: not a git repository" is not an answer to "rewind".
    await this.repositoryRoot();
    const listing = await this.git.run([
      'for-each-ref',
      '--format=%(refname)%09%(objectname)%09%(contents)',
      MILESTONE_REF_PREFIX,
    ]);
    const found: Milestone[] = [];
    // A ref's own body can hold newlines, so records are split on the ref prefix.
    for (const chunk of listing.split(`${MILESTONE_REF_PREFIX}/`)) {
      if (chunk.trim() === '') continue;
      const [head, ...body] = `${MILESTONE_REF_PREFIX}/${chunk}`.split('\t');
      const id = idFromRef((head ?? '').trim());
      const commit = (body[0] ?? '').trim();
      if (id === null || commit === '') continue;
      const decoded = decodeMessage(body.slice(1).join('\t'));
      if (decoded === null) continue;
      found.push({ id, commit, ...decoded });
    }
    return found.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  }

  async latest(): Promise<Milestone | null> {
    return (await this.list())[0] ?? null;
  }

  /**
   * The working tree, put back: every file the milestone held is written and the ones that
   * arrived after it are deleted, after a milestone of the current state so it can be undone.
   */
  async restore(id: string, at: string): Promise<RestoreResult> {
    const root = await this.repositoryRoot();
    await this.refuseIfMidOperation(root);
    const target = await this.find(id);
    const kept = await this.take({
      at,
      reason: MILESTONE_REASON.REPLACED,
      note: `what ${target.id} replaced`,
    });

    // Computed before the checkout, which would blur what the agent added into the rest.
    const added = await this.filesAddedBetween(target, kept);
    const env = scratchEnv(root);
    try {
      await this.git.run(['read-tree', target.commit], env);
      await this.git.run(['checkout-index', '-a', '-f'], env);
    } finally {
      await this.dropIndex(env);
    }
    // Unlinked rather than `git rm`, which would consult the person's own index. An ignored
    // file made since is left, since a rewind never deletes what git would never track.
    const ignored = new Set(await this.ignoredAmong(added));
    for (const path of added) {
      if (!ignored.has(path)) await this.tree.remove(`${root}/${path}`);
    }
    return { restored: target, kept };
  }

  private async ignoredAmong(paths: readonly string[]): Promise<string[]> {
    if (paths.length === 0) return [];
    // `check-ignore` exits non-zero when none are ignored, which is an answer, not a failure.
    const listing = await this.git.run(['check-ignore', '--', ...paths]).catch(() => '');
    return nonEmptyLines(listing);
  }

  private async find(id: string): Promise<Milestone> {
    const target = (await this.list()).find((milestone) => milestone.id === id);
    if (target === undefined) {
      throw new RewindRefused(
        REWIND_REFUSAL.UNKNOWN_MILESTONE,
        `No milestone ${id}. "memnox rewind --list" shows the ones there are.`,
      );
    }
    return target;
  }

  /** Present now and absent from the milestone, so created after it. */
  private async filesAddedBetween(from: Milestone, to: Milestone): Promise<string[]> {
    const listing = await this.git.run([
      'diff',
      '--name-only',
      '--diff-filter=A',
      from.commit,
      to.commit,
    ]);
    return nonEmptyLines(listing);
  }

  /**
   * What the working tree changed since a milestone, file by file. The current tree is
   * written as objects only, so nothing a person sees, no ref and no index, moves.
   */
  async changedSince(id: string): Promise<FileChange[]> {
    return this.changedFrom((await this.find(id)).commit);
  }

  /** The diff of one file since a milestone, as git prints it. */
  async diffSince(id: string, path: string): Promise<string> {
    return this.diffFrom((await this.find(id)).commit, path);
  }

  /**
   * What the working tree changed since the last commit made before `moment`, for a session no
   * milestone was taken for, so work the session has already committed is still its work.
   */
  async changedSinceCommit(moment?: string): Promise<FileChange[]> {
    const base = await this.commitBefore(moment);
    return base === null ? [] : this.changedFrom(base);
  }

  async diffSinceCommit(path: string, moment?: string): Promise<string> {
    const base = await this.commitBefore(moment);
    return base === null ? '' : this.diffFrom(base, path);
  }

  /** The newest commit made before the moment, or the head when no moment or none that old. */
  private async commitBefore(moment?: string): Promise<string | null> {
    if (moment === undefined) return this.head();
    try {
      const found = await this.git.run(['rev-list', '-1', `--before=${moment}`, 'HEAD']);
      return found === '' ? await this.head() : found;
    } catch {
      // No commits yet, which leaves nothing to compare against.
      return null;
    }
  }

  private async changedFrom(commit: string): Promise<FileChange[]> {
    const { tree } = await this.writeWorkingTree(await this.repositoryRoot());
    const range = ['--no-renames', commit, tree];
    const statuses = await this.git.run(['diff', '--name-status', ...range]);
    const counts = await this.git.run(['diff', '--numstat', ...range]);
    return mergedChanges(nonEmptyLines(statuses), nonEmptyLines(counts));
  }

  private async diffFrom(commit: string, path: string): Promise<string> {
    const { tree } = await this.writeWorkingTree(await this.repositoryRoot());
    return this.git.run(['diff', '--no-renames', commit, tree, '--', path]);
  }

  async forget(keep: number = MILESTONE_KEEP): Promise<string[]> {
    const dropped = milestonesToForget(await this.list(), keep);
    for (const milestone of dropped) {
      await this.git.run(['update-ref', '-d', refFor(milestone.id)]);
    }
    return dropped.map((milestone) => milestone.id);
  }

  private async head(): Promise<string | null> {
    try {
      return await this.git.run(['rev-parse', 'HEAD']);
    } catch {
      // No commits yet. The milestone is simply parentless.
      return null;
    }
  }

  private async repositoryRoot(): Promise<string> {
    const root = await this.git.root();
    if (root === null) {
      throw new RewindRefused(
        REWIND_REFUSAL.NOT_A_REPO,
        'Not a git repository, so there is no working tree to keep.',
      );
    }
    return root;
  }

  /**
   * Mid-merge, the state that says how to finish lives in files a restore would write
   * over. Refusing is the only honest answer: finishing or aborting is the person's call.
   */
  private async refuseIfMidOperation(root: string): Promise<void> {
    for (const [marker, what] of IN_PROGRESS) {
      if (await this.tree.exists(`${root}/.git/${marker}`)) {
        throw new RewindRefused(
          REWIND_REFUSAL.MID_OPERATION,
          `${what} is in progress here. Finish or abort it first, because a rewind would write over the state that says how.`,
        );
      }
    }
  }
}

/** `--name-status` and `--numstat` lines joined by path, since neither says both. */
function mergedChanges(
  statuses: readonly string[],
  counts: readonly string[],
): FileChange[] {
  const lines = new Map<string, { added: number | null; removed: number | null }>();
  for (const line of counts) {
    const [added = '-', removed = '-', path = ''] = line.split('\t');
    lines.set(path, { added: countOf(added), removed: countOf(removed) });
  }
  return statuses.map((line) => {
    const [status = 'M', path = ''] = line.split('\t');
    return { path, status, ...(lines.get(path) ?? { added: null, removed: null }) };
  });
}

/** Git prints a dash for a binary file, which has no lines to count. */
function countOf(field: string): number | null {
  return field === '-' ? null : Number(field);
}
