import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  LocalGate,
  loadPolicySet,
  MEMNOX_HOME,
  orgConditionsPathFor,
  orgPolicyPathFor,
  overlayPathFor,
  overlaysInForce,
  POLICY_REGISTRY_FILE,
  readPolicyFiles,
  stateLabelsOf,
  type NoticePort,
  type Overlay,
  type Policy,
} from '@memnox/core';

import { gateOver, type LocalGateEnvironment } from './local-gate-loader';

/**
 * The proxy outlives every file it rules by, so the gate is read again whenever one of them
 * changed: a pause, a pulled bundle or an edited rule decides the very next call. A stat per
 * file is the whole cost of a call where nothing changed.
 */

/** Where the authorizer gets its gate, asked once per call. */
export interface GateSource {
  /** The gate as the disk stands now; null while nothing is there to govern. */
  current(): Promise<LocalGate | null>;
  /** The last one read, for a question that cannot wait on a disk. */
  latest(): LocalGate | null;
}

/** A gate that never changes, which is what a test or an embedding hands in. */
export function fixedGate(gate: LocalGate): GateSource {
  return { current: async () => gate, latest: () => gate };
}

export interface LiveGateOptions {
  environment: LocalGateEnvironment;
  serverName: string;
  home: string;
  warn?: (message: string) => void;
  now?: () => Date;
}

export class LiveGate implements GateSource {
  private gate: LocalGate | null = null;
  private notice: NoticePort | null = null;
  private policies: Policy[] = [];
  private overlays: Overlay[] = [];
  private files: string[] | null = null;
  private listStamp: string | null = null;
  private filesStamp: string | null = null;
  private overlayStamp: string | null = null;
  private labels: string | null = null;
  private reading: Promise<LocalGate | null> | null = null;

  constructor(private readonly options: LiveGateOptions) {}

  current(): Promise<LocalGate | null> {
    // Calls arriving together share one read rather than each racing the disk.
    this.reading ??= this.read().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  latest(): LocalGate | null {
    return this.gate;
  }

  /** Kept and put on every gate read after, so noticing survives a reload. */
  attachNotice(notice: NoticePort): void {
    this.notice = notice;
    this.gate?.attachNotice(notice);
  }

  private async read(): Promise<LocalGate | null> {
    try {
      const rulesChanged = await this.readRules();
      await this.readConditions();
      const facts = stateLabelsOf(this.overlays, this.now().toISOString());
      const labels = [...facts].sort().join('\n');
      if (!rulesChanged && labels === this.labels) return this.gate;
      this.labels = labels;
      this.gate = this.build(facts);
    } catch (err) {
      // A registry caught mid write is read again next call; the last gate stands meanwhile.
      this.warn(`could not read the rules again, so the last ones stand: ${String(err)}`);
    }
    return this.gate;
  }

  /** True when a rule file, the registry or the bundle changed since the last read. */
  private async readRules(): Promise<boolean> {
    const { environment, home } = this.options;
    const listed = await stampOf([
      join(home, MEMNOX_HOME, POLICY_REGISTRY_FILE),
      orgPolicyPathFor(home),
    ]);
    if (this.files === null || listed !== this.listStamp) {
      this.files = await readPolicyFiles(environment.policies, home);
      this.listStamp = listed;
    }
    const files = this.files;
    const stamp = await stampOf(files);
    if (stamp === this.filesStamp) return false;
    const set = await loadPolicySet(files);
    for (const broken of set.unreadable) {
      this.warn(
        `${broken.file} would not load, so its rules are not in force: ${broken.issues.length} problem(s)`,
      );
    }
    if (set.policies.length === 0 && set.unreadable.length > 0) {
      this.warn('no rule file loaded, so nothing is being gated here');
    }
    this.policies = set.policies;
    this.filesStamp = stamp;
    return true;
  }

  private async readConditions(): Promise<void> {
    const { home } = this.options;
    const stamp = await stampOf([overlayPathFor(home), orgConditionsPathFor(home)]);
    if (stamp === this.overlayStamp) return;
    this.overlays = await overlaysInForce(home);
    this.overlayStamp = stamp;
  }

  /** Null with no rule and nothing in force, so an unconfigured machine stays ungoverned. */
  private build(facts: readonly string[]): LocalGate | null {
    if (this.policies.length === 0 && facts.length === 0) return null;
    const gate = gateOver(this.policies, {
      environment: this.options.environment,
      serverName: this.options.serverName,
      home: this.options.home,
      stateFacts: facts,
    });
    if (this.notice !== null) gate.attachNotice(this.notice);
    return gate;
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private warn(message: string): void {
    this.options.warn?.(message);
  }
}

/** Each file's identity and size, so an atomic rename and an edit in place are both seen. */
async function stampOf(paths: readonly string[]): Promise<string> {
  const stamps = await Promise.all(
    paths.map(async (path) => {
      try {
        const found = await stat(path);
        return `${path}@${found.ino}:${found.mtimeMs}:${found.size}`;
      } catch {
        return `${path}@none`;
      }
    }),
  );
  return stamps.join('\n');
}
