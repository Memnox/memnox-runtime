import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cursorRuleText,
  INSTRUCTION_MARKERS,
  INSTRUCTION_TARGETS,
  instructionBody,
  instructionTargetFor,
  NATIVE_PLACED,
  placeNativeBlock,
  placeNativeFile,
  removeNativeBlock,
  removeNativeFile,
  TOOL_CLASS,
  type InstructionSource,
  type InstructionTarget,
  type NativePlaced,
} from '@memnox/core';
import {
  CONFIG_RULE,
  recordConfigChanges,
  type ConfigRecord,
} from '../keeper/config-events';

/**
 * A project's instructions handed to each of its agents in that agent's own file: a fenced block
 * inside a file a person also writes in, or a whole file of ours where the agent reads a folder.
 */

const OPERATION = {
  WRITTEN: 'project.instructions.written',
  REMOVED: 'project.instructions.removed',
} as const;

/** What one pass did to the instruction files, each path relative to the repository. */
interface InstructionsHanded {
  written: string[];
  removed: string[];
  kept: string[];
  /** Every file holding something of ours once the pass is done. */
  ours: string[];
}

/** Each named file as it reads now; a file named and missing is skipped rather than refused. */
export async function readInstructionSources(
  root: string,
  paths: readonly string[],
): Promise<InstructionSource[]> {
  const read = await Promise.all(
    paths.map(async (path) => {
      const text = await readFile(join(root, path), 'utf8').catch(
        // A source named and not there yet is the person's to add; the others still go out.
        (): string | null => null,
      );
      return text === null ? null : { path, text };
    }),
  );
  return read.filter((source): source is InstructionSource => source !== null);
}

/** Every target of the project's agents, each file once, however many agents read it. */
function targetsOf(agents: readonly string[]): InstructionTarget[] {
  const targets = new Map<string, InstructionTarget>();
  for (const agent of agents) {
    const target = instructionTargetFor(agent);
    if (target !== undefined && !targets.has(target.path))
      targets.set(target.path, target);
  }
  return [...targets.values()];
}

/**
 * The instructions written into every target, and taken out of any file of ours no target wants
 * any more. Every write and removal leaves a `config` row naming the file.
 */
export async function handInstructions(
  home: string,
  hand: {
    root: string;
    agents: readonly string[];
    sources: readonly InstructionSource[];
    previous: readonly string[];
  },
  now: Date,
): Promise<InstructionsHanded> {
  const handed: InstructionsHanded = { written: [], removed: [], kept: [], ours: [] };
  const targets = targetsOf(hand.agents);
  for (const target of targets) {
    const body = instructionBody(target, hand.sources);
    if (body === '') {
      if (await takeOut(hand.root, target)) handed.removed.push(target.path);
      continue;
    }
    const placed = await placeTarget(hand.root, target, body);
    if (placed === NATIVE_PLACED.KEPT) handed.kept.push(target.path);
    else handed.ours.push(target.path);
    if (placed === NATIVE_PLACED.WRITTEN) handed.written.push(target.path);
  }
  const wanted = new Set(targets.map((target) => target.path));
  for (const stale of hand.previous.filter((path) => !wanted.has(path)))
    if (await takeOut(hand.root, staleTarget(stale))) handed.removed.push(stale);
  await recordConfigChanges(home, recordsOf(hand.root, handed), now);
  return handed;
}

function placeTarget(
  root: string,
  target: InstructionTarget,
  body: string,
): Promise<NativePlaced> {
  const path = join(root, target.path);
  return target.whole
    ? placeNativeFile({ path, content: cursorRuleText(body) })
    : placeNativeBlock(path, body, INSTRUCTION_MARKERS);
}

function takeOut(root: string, target: InstructionTarget): Promise<boolean> {
  const path = join(root, target.path);
  return target.whole
    ? removeNativeFile(path)
    : removeNativeBlock(path, INSTRUCTION_MARKERS);
}

/** A file written before for an agent the project no longer names, read as the target it was. */
function staleTarget(path: string): InstructionTarget {
  const whole = INSTRUCTION_TARGETS.some(
    (target) => target.path === path && target.whole,
  );
  return { agent: '', path, whole };
}

function recordsOf(root: string, handed: InstructionsHanded): ConfigRecord[] {
  const record = (operation: string, path: string, summary: string): ConfigRecord => ({
    operation,
    file: join(root, path),
    summary,
    class: TOOL_CLASS.WRITE,
    rule: CONFIG_RULE.PROJECTS,
  });
  return [
    ...handed.written.map((path) =>
      record(OPERATION.WRITTEN, path, `the project's instructions written into ${path}`),
    ),
    ...handed.removed.map((path) =>
      record(OPERATION.REMOVED, path, `the project's instructions taken out of ${path}`),
    ),
  ];
}
