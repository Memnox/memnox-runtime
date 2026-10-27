import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEMNOX_HOME } from '@memnox/core';
import { AcpBrain } from './acp-brain';
import { rememberBrainSession } from './brain-sessions';
import { BRAIN_CHUNK, type Brain, type BrainChunk } from './brain';
import { VoiceAgents } from './voice-agents';
import { ClaudeCodeBrain } from './claude-brain';
import { readAddress, readOwner } from './owner';
import { runMemnox } from '../session-tools/voice-commands';
import { readVocabulary } from './vocabulary';
import {
  installedBrains,
  VOICE_BRAIN,
  VOICE_BRAINS,
  type VoiceBrainSpec,
} from './voice-brains';

/** This install's own operator server, started by the brain with the node running Memnox. */
function operatorServer(): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL('./bin/operator.js', import.meta.url))],
  };
}

let catalogue: Promise<string> | null = null;

/** Read from this install's own help once per daemon, since commands only change with an update. */
export function commandCatalogue(): Promise<string> {
  catalogue ??= runMemnox(
    ['help', '--tree'],
    CATALOGUE_TIMEOUT_MS,
    MOST_CATALOGUE_CHARS,
  ).then((ran) => (ran.exitCode === 0 ? ran.output : ''));
  return catalogue;
}

const CATALOGUE_TIMEOUT_MS = 10_000;
/** Every command fits with room to grow; a catalogue cut short would hide the commands at its end. */
const MOST_CATALOGUE_CHARS = 20_000;

/** Set to `sonnet` or `opus` for a slower, deeper voice. */
const VOICE_MODEL_VAR = 'MEMNOX_VOICE_MODEL';
const DEFAULT_VOICE_MODEL = 'haiku';

/** Where a check keeps its conversation, so a setup question is never what the voice resumes. */
const CHECK_HOME = join(tmpdir(), 'memnox-brain-check');

/**
 * One agent as the voice's brain. `conversations` is where its thread is kept, which is the
 * person's home for the voice and somewhere else for a check.
 */
function brainFor(
  spec: VoiceBrainSpec,
  home: string,
  conversations: string = home,
): Brain {
  const shared = {
    home: conversations,
    operator: operatorServer(),
    cwd: join(home, MEMNOX_HOME),
    vocabulary: () => readVocabulary(home),
    address: () => readAddress(home),
    name: () => readOwner(home),
    catalogue: commandCatalogue,
  };
  if (spec.kind !== VOICE_BRAIN.CLAUDE_CODE) {
    // Kept in the person's home even for a check, since the agent lists a check's session beside theirs.
    const opened = (sessionId: string): Promise<void> =>
      rememberBrainSession(home, sessionId);
    return new AcpBrain({ ...shared, spec, opened });
  }
  return new ClaudeCodeBrain({
    ...shared,
    // Quick talk rather than depth: the person's own default model stays theirs everywhere else.
    model: process.env[VOICE_MODEL_VAR] ?? DEFAULT_VOICE_MODEL,
    effort: 'low',
  });
}

/** A brain kept out of the voice's conversation, for checking whether an agent answers. */
function checkableBrain(spec: VoiceBrainSpec, home: string): Brain {
  return brainFor(spec, home, CHECK_HOME);
}

/** The agents the voice can think with on this machine, checked and chosen as the Mac app asks. */
export function voiceAgentsFor(home: string): VoiceAgents {
  return new VoiceAgents(home, {
    env: process.env,
    installed: () => installedBrains(),
    checkable: (spec) => checkableBrain(spec, home),
  });
}

/** The brain the person already pays for, so `ask` and the daemon think with the same one. */
export function ownBrain(
  home: string,
  agents: VoiceAgents = voiceAgentsFor(home),
): Brain {
  return new ChosenBrain(home, agents);
}

/**
 * Whichever agent is chosen, asked again before every question so a pick made in the Mac
 * app's settings is the next answer's brain, and found lazily since finding it may cost a check.
 */
class ChosenBrain implements Brain {
  private current: { kind: string; brain: Brain } | null = null;

  constructor(
    private readonly home: string,
    private readonly agents: VoiceAgents,
  ) {}

  get name(): string {
    return this.current?.brain.name ?? 'agent';
  }

  async *ask(said: string): AsyncIterable<BrainChunk> {
    const brain = await this.brain();
    if (brain === null) {
      yield { kind: BRAIN_CHUNK.FAILED, text: NO_AGENT };
      return;
    }
    yield* brain.ask(said);
  }

  async warm(): Promise<void> {
    await (await this.brain())?.warm();
  }

  close(): void {
    this.current?.brain.close();
  }

  cancel(): void {
    this.current?.brain.cancel();
  }

  private async brain(): Promise<Brain | null> {
    const spec = await this.agents.pick();
    if (spec === null) return null;
    if (this.current?.kind === spec.kind) return this.current.brain;
    // Another agent was picked, so the old one's warm process is let go.
    this.current?.brain.close();
    this.current = { kind: spec.kind, brain: brainFor(spec, this.home) };
    return this.current.brain;
  }
}

const NO_AGENT = `No agent on this machine can be the voice. Install and log in to one of ${VOICE_BRAINS.map((spec) => spec.label).join(', ')}.`;
