import { readJsonFile, writeJsonFile, type VoiceAgentStatus } from '@memnox/core';
import { voiceAgentsPath, voiceBrainPath } from '../memnox-paths';
import type { Brain } from './brain';
import { checkBrain, type BrainCheck } from './brain-check';
import {
  VOICE_BRAIN_VAR,
  VOICE_BRAINS,
  voiceBrainSpec,
  type VoiceBrainKind,
  type VoiceBrainSpec,
} from './voice-brains';

/**
 * Which of the person's agents the voice thinks with. Nothing here is asked of a person in
 * a terminal: the first time the Mac app listens every installed agent is checked and one
 * that answered is kept, and the app's settings show the rest and let them pick another.
 */

interface VoiceAgentSeams {
  env: NodeJS.ProcessEnv;
  installed: () => VoiceBrainSpec[];
  /** A brain to check with, kept out of the voice's own conversation. */
  checkable: (spec: VoiceBrainSpec) => Brain;
  check?: typeof checkBrain;
  now?: () => Date;
}

interface KeptCheck {
  kind: string;
  works: boolean;
  because?: string;
  reply?: string;
}

interface KeptChecks {
  checkedAt: string;
  checks: KeptCheck[];
}

interface Chosen {
  brain: VoiceBrainKind;
  chosenAt: string;
}

export class VoiceAgents {
  /** One check at a time, so the app opening and the first question never ask every agent twice. */
  private checking: Promise<VoiceAgentStatus[]> | null = null;

  constructor(
    private readonly home: string,
    private readonly seams: VoiceAgentSeams,
  ) {}

  /** Every agent the voice knows, answered from the last check unless asked to check again. */
  async list(recheck = false): Promise<VoiceAgentStatus[]> {
    if (recheck || (await this.kept()) === null) return this.checkAll();
    return this.roster();
  }

  /** The person's pick, refused for an agent that is not on this Mac; the reason is the string. */
  async choose(kind: string): Promise<VoiceAgentStatus[] | string> {
    const spec = voiceBrainSpec(kind);
    if (spec === null) return `the voice knows no agent called ${kind}`;
    if (!this.installed().some((each) => each.kind === spec.kind)) {
      return `${spec.label} is not installed on this Mac`;
    }
    await this.keepChoice(spec.kind);
    return this.roster();
  }

  /**
   * The brain to think with: one named in the env, else the one chosen while it is still
   * installed, else whatever the first check chose. Null only when no agent is installed.
   */
  async pick(): Promise<VoiceBrainSpec | null> {
    const named = this.seams.env[VOICE_BRAIN_VAR];
    const pinned = named === undefined ? null : voiceBrainSpec(named);
    if (pinned !== null) return pinned;
    const installed = this.installed();
    const chosen = await this.chosen(installed);
    if (chosen !== null) return chosen;
    const [first] = installed;
    if (first === undefined) return null;
    if ((await this.kept()) === null) {
      await this.checkAll();
      const found = await this.chosen(installed);
      if (found !== null) return found;
    }
    // None answered, so the first one's own failure is what the person hears.
    return first;
  }

  private checkAll(): Promise<VoiceAgentStatus[]> {
    this.checking ??= this.runChecks().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  /** Every installed agent at once, since each is a cold start; then the best that answered is kept. */
  private async runChecks(): Promise<VoiceAgentStatus[]> {
    const check = this.seams.check ?? checkBrain;
    const installed = this.installed();
    const checks = await Promise.all(
      installed.map((spec) =>
        check(spec, this.seams.checkable(spec)).catch((error: unknown): BrainCheck => ({
          spec,
          works: false,
          because: error instanceof Error ? error.message : 'the check failed',
        })),
      ),
    );
    const kept: KeptChecks = {
      checkedAt: this.now().toISOString(),
      checks: checks.map(({ spec, works, because, reply }) => ({
        kind: spec.kind,
        works,
        ...(because === undefined ? {} : { because }),
        ...(reply === undefined ? {} : { reply }),
      })),
    };
    await writeJsonFile(voiceAgentsPath(this.home), kept).catch(() => undefined);
    await this.keepBest(checks, installed);
    return this.roster();
  }

  /**
   * Kept unless the agent chosen still answers. Preference order puts the ones kept to reading
   * first, so one that cannot be is taken only when nothing else answered.
   */
  private async keepBest(
    checks: readonly BrainCheck[],
    installed: readonly VoiceBrainSpec[],
  ): Promise<void> {
    const chosen = await this.chosen(installed);
    const working = checks.filter((check) => check.works);
    if (chosen !== null && working.some((check) => check.spec.kind === chosen.kind))
      return;
    const best = working.find((check) => check.spec.sealed) ?? working[0];
    if (best !== undefined) await this.keepChoice(best.spec.kind);
  }

  private async roster(): Promise<VoiceAgentStatus[]> {
    const installed = this.installed();
    const kept = await this.kept();
    const chosen = await this.chosen(installed);
    return VOICE_BRAINS.map((spec) => {
      const here = installed.some((each) => each.kind === spec.kind);
      const check = here
        ? kept?.checks.find((each) => each.kind === spec.kind)
        : undefined;
      return {
        kind: spec.kind,
        label: spec.label,
        installed: here,
        sealed: spec.sealed,
        ...(check === undefined ? {} : { works: check.works }),
        ...(check?.because === undefined ? {} : { because: check.because }),
        ...(check?.reply === undefined ? {} : { reply: check.reply }),
        ...(check === undefined || kept === null ? {} : { checkedAt: kept.checkedAt }),
        chosen: chosen?.kind === spec.kind,
        install: spec.install,
      };
    });
  }

  private async chosen(
    installed: readonly VoiceBrainSpec[],
  ): Promise<VoiceBrainSpec | null> {
    const kept = await readJsonFile<Chosen>(voiceBrainPath(this.home));
    const spec = kept === null ? null : voiceBrainSpec(kept.brain);
    return spec !== null && installed.some((each) => each.kind === spec.kind)
      ? spec
      : null;
  }

  private async keepChoice(kind: VoiceBrainKind): Promise<void> {
    const kept: Chosen = { brain: kind, chosenAt: this.now().toISOString() };
    await writeJsonFile(voiceBrainPath(this.home), kept);
  }

  private kept(): Promise<KeptChecks | null> {
    return readJsonFile<KeptChecks>(voiceAgentsPath(this.home));
  }

  private installed(): VoiceBrainSpec[] {
    return this.seams.installed();
  }

  private now(): Date {
    return this.seams.now?.() ?? new Date();
  }
}
