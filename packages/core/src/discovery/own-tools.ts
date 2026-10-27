import { TOOL_EFFECT, type ToolEffect } from './discovery.constants';
import type { EnvironmentSnapshot } from './snapshot';
import type { McpToolAnnotations, McpToolDeclaration } from './surface';

/**
 * What Memnox's own tools do, known here rather than guessed from their names, because
 * a rule asking about `unknown` tools otherwise held the reads Memnox tells an agent to
 * make before it changes anything.
 */

/** The name onboarding gives the workspace's server in an agent's config. */
export const WORKSPACE_SERVER_NAME = 'memnox';

/** The name every onboarding gives Memnox's session server in an agent's config. */
export const SESSION_SERVER_NAME = 'memnox-session';

const READS: McpToolAnnotations = { readOnlyHint: true, destructiveHint: false };
const WRITES: McpToolAnnotations = { readOnlyHint: false, destructiveHint: false };
const DESTROYS: McpToolAnnotations = { readOnlyHint: false, destructiveHint: true };

/** The workspace's tools as memnox-cloud annotates them; the prefix makes any server name safe to read. */
export const WORKSPACE_TOOL_ANNOTATIONS: Readonly<Record<string, McpToolAnnotations>> = {
  memnox_rules_in_force: READS,
  memnox_boundary: READS,
  memnox_check_approval: READS,
  memnox_memory: READS,
  memnox_context: READS,
  memnox_people: READS,
  memnox_workspace: READS,
  memnox_sources: READS,
  memnox_source: READS,
  // These write the workspace's own ledger, approvals and leases, and nothing outside Memnox.
  memnox_report_action: WRITES,
  memnox_request_approval: WRITES,
  memnox_hold_path: WRITES,
  memnox_release_path: WRITES,
  memnox_claim_action: WRITES,
  memnox_finish_action: WRITES,
};

/** The session server's tools, trusted only on that server since `status` alone could be anybody's. */
export const SESSION_TOOL_ANNOTATIONS: Readonly<Record<string, McpToolAnnotations>> = {
  why: READS,
  status: READS,
  replay: READS,
  decisions: READS,
  memory: READS,
  brief: READS,
  work: READS,
  // Writes one file in `.memnox`, and only ever adds what agents are held to.
  fingerprint: WRITES,
  rewind: DESTROYS,
};

/** Every workspace tool carries it, so one the cloud adds needs no runtime release. */
const WORKSPACE_TOOL_PREFIX = 'memnox_';

/**
 * Memnox's own tools, which no rule is asked about, since holding a request for approval
 * asks one person twice. Only on the server onboarding wrote, so a lookalike is ruled on.
 */
export function isWorkspaceTool(
  server: string,
  tool: string,
  projectNamesServer: (server: string) => boolean = () => false,
): boolean {
  // A project file naming a server `memnox` is anybody's, and its tools are ruled on like any.
  if (projectNamesServer(server)) return false;
  return server === WORKSPACE_SERVER_NAME && tool.startsWith(WORKSPACE_TOOL_PREFIX);
}

/** A tool's declaration where one is known, for a seam that only sees the tool's name. */
export type ToolDeclarations = (
  server: string,
  tool: string,
) => McpToolDeclaration | undefined;

/** Memnox's own declaration of one of its tools, or undefined for anybody else's. */
export function ownToolDeclaration(
  server: string,
  tool: string,
): McpToolDeclaration | undefined {
  // By name only on the server Memnox wrote, so a lookalike elsewhere is classified on its own.
  const annotations =
    server === WORKSPACE_SERVER_NAME
      ? WORKSPACE_TOOL_ANNOTATIONS[tool]
      : server === SESSION_SERVER_NAME
        ? SESSION_TOOL_ANNOTATIONS[tool]
        : undefined;
  return annotations === undefined ? undefined : { name: tool, annotations };
}

/** Where an agent names no server, as Cursor does, every server is a candidate. */
const ANY_SERVER = '*';

/**
 * Memnox's own tools first, then what the last scan heard each server say about its
 * tools, so a hook that sees only a name rules as the proxy would with the full listing.
 */
export function toolDeclarations(snapshot: EnvironmentSnapshot | null): ToolDeclarations {
  return (server, tool) =>
    ownToolDeclaration(server, tool) ?? scannedDeclaration(snapshot, server, tool);
}

function scannedDeclaration(
  snapshot: EnvironmentSnapshot | null,
  server: string,
  tool: string,
): McpToolDeclaration | undefined {
  if (snapshot === null) return undefined;
  const effects = new Set<ToolEffect>();
  for (const listed of snapshot.servers) {
    if (server !== ANY_SERVER && listed.name !== server) continue;
    for (const each of listed.tools) {
      if (each.name === tool) effects.add(each.effect);
    }
  }
  // Two servers saying different things about one name is no answer, so the name decides.
  if (effects.size !== 1) return undefined;
  const [effect] = [...effects];
  const annotations = effect === undefined ? undefined : annotationsOf(effect);
  return annotations === undefined ? undefined : { name: tool, annotations };
}

function annotationsOf(effect: ToolEffect): McpToolAnnotations | undefined {
  if (effect === TOOL_EFFECT.READ) return READS;
  if (effect === TOOL_EFFECT.WRITE) return WRITES;
  if (effect === TOOL_EFFECT.DESTRUCTIVE) return DESTROYS;
  return undefined;
}
