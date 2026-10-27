import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  discover,
  NodeMachineReader,
  NodeHostInspector,
  NodeMcpLister,
  NodeSnapshotStore,
  NodeToolListCache,
  CachedMcpLister,
  RecordingMcpLister,
  snapshotOf,
  type DiscoveryReport,
  type EnvironmentSnapshot,
  type HostInspector,
  type MachineReader,
  type McpLister,
  type SnapshotStore,
  type ToolListCache,
  loadPolicySet,
  matchesPattern,
  MEMNOX_HOME,
  readPolicyRegistry,
  type Policy,
  type UnreadablePolicyFile,
} from '@memnox/core';
import { policyRegistryPath } from './policy-registry';

/** Scanning this machine, and asking which of what the scan found any local rule covers. */

/** The action an MCP tool call is named by, which is what a rule has to match. */
const MCP_ACTION_PREFIX = 'mcp';

/** The machine, as an argument, so a test of any command that scans never reads the real home. */
export interface ScanSeams {
  reader: MachineReader;
  lister: () => McpLister;
  snapshots: SnapshotStore;
  /** Directories the reader works in: these hold the credentials a repository has. */
  projectDirs: readonly string[];
  now: () => string;
  /** Rule files the runtime would read, so "no rule covers this" is checkable offline. */
  policyFiles: () => Promise<string[]>;
  /** The environment an agent would start with, which is where PATH finds its binary. */
  env?: NodeJS.ProcessEnv;
  /** Asks who signed each agent's binary. Absent, the signer reads as unknown. */
  inspector?: HostInspector;
  /** What each server answered last, so a scan that starts nothing can still count its tools. */
  toolLists?: ToolListCache;
}

export function defaultScanSeams(cwd: string = process.cwd()): ScanSeams {
  const home = homedir();
  return {
    reader: new NodeMachineReader(home),
    lister: () => new NodeMcpLister(),
    snapshots: new NodeSnapshotStore(join(home, MEMNOX_HOME)),
    projectDirs: [cwd],
    now: () => new Date().toISOString(),
    policyFiles: () => readPolicyRegistry(policyRegistryPath(home)),
    env: process.env,
    inspector: new NodeHostInspector(),
    toolLists: new NodeToolListCache(home),
  };
}

interface Scan {
  report: DiscoveryReport;
  snapshot: EnvironmentSnapshot;
  /** Servers whose tools are unknown, since nothing has ever asked them; empty after a probe. */
  unasked: string[];
}

/**
 * One scan, kept. Every command that reads the machine also records what it saw, which
 * is the only reason `scan --since` has anything to compare against on the second run.
 */
export async function scanMachine(
  seams: ScanSeams,
  options: { probe: boolean; save?: boolean } = { probe: true },
): Promise<Scan> {
  const now = seams.now();
  const lister = await listerFor(seams, options.probe);
  const report = await discover(seams.reader, {
    now,
    projectDirs: seams.projectDirs,
    ...(seams.env === undefined ? {} : { env: seams.env }),
    ...(seams.inspector === undefined ? {} : { inspector: seams.inspector }),
    ...(lister === null ? {} : { lister }),
  });
  if (lister instanceof RecordingMcpLister) await seams.toolLists?.merge(lister.heard);
  const snapshot = snapshotOf(report, now);
  if (options.save !== false) await seams.snapshots.save(snapshot);
  const unasked = lister instanceof CachedMcpLister ? [...new Set(lister.missed)] : [];
  return { report, snapshot, unasked };
}

/** Starting somebody else's server is the one thing here that runs code, so without a probe only what was kept answers. */
async function listerFor(seams: ScanSeams, probe: boolean): Promise<McpLister | null> {
  if (probe) return new RecordingMcpLister(seams.lister());
  if (seams.toolLists === undefined) return null;
  return new CachedMcpLister(
    await seams.toolLists.read(),
    await seams.snapshots.latest(),
  );
}

interface RuleCoverage {
  covered: string[];
  /** Files that would not load, so a coverage count reads as a floor and not a total. */
  unreadable: UnreadablePolicyFile[];
}

/**
 * Whether any local rule reaches an MCP tool at all. An arrival nothing covers is the
 * line the report exists to print, so it is answered from the rule set rather than
 * assumed.
 */
export async function rulesCovering(
  seams: ScanSeams,
  toolNames: readonly string[],
): Promise<RuleCoverage> {
  // Unreadable files are carried, or a broken rule set would read as "no rule covers this".
  const rules = await loadPolicySet(await seams.policyFiles());
  const covered = new Set<string>();
  for (const name of toolNames) {
    const action = `${MCP_ACTION_PREFIX}.${name}`;
    if (rules.policies.some((policy) => matchesAction(policy, action))) covered.add(name);
  }
  return { covered: [...covered], unreadable: rules.unreadable };
}

function matchesAction(policy: Policy, action: string): boolean {
  const actions = policy.match.actions;
  if (actions === undefined || actions.length === 0) return false;
  return actions.some((pattern) => matchesPattern(pattern, action));
}
