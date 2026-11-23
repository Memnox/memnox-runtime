import { basename, dirname, join } from 'node:path';
import {
  DISCOVERED_AGENT_KIND,
  SHARED_CONFIG_PARENTS,
  SURFACE_KIND,
} from '../discovery.constants';
import { ConfigDetector, type ConfigDetectorSpec } from './config-detector';
import type { AgentDetector } from './detector';
import { CodexDetector } from './codex-detector';
import { HermesDetector } from './hermes-detector';
import { OpenClawDetector } from './openclaw-detector';
import { RufloDetector } from './ruflo-detector';

/**
 * A versioned, separately releasable set with the layout revision each was written
 * against, because every one of them depends on somebody else's undocumented format.
 */
const DETECTOR_SPECS: readonly ConfigDetectorSpec[] = [
  {
    kind: DISCOVERED_AGENT_KIND.CLAUDE_CODE,
    layoutVersion: '2026-08',
    configPaths: ['.claude.json', '.claude/settings.json'],
    clients: ['Claude Code'],
    inherentSurfaces: [
      SURFACE_KIND.SHELL,
      SURFACE_KIND.FILESYSTEM,
      SURFACE_KIND.GIT,
      SURFACE_KIND.NETWORK,
    ],
    mcpConfigPaths: ['.claude.json'],
  },
  {
    kind: DISCOVERED_AGENT_KIND.CLAUDE_DESKTOP,
    layoutVersion: '2026-08',
    configPaths: [
      'Library/Application Support/Claude/claude_desktop_config.json',
      '.config/Claude/claude_desktop_config.json',
    ],
    clients: ['Claude Desktop'],
    inherentSurfaces: [SURFACE_KIND.NETWORK],
    // macOS first, then Linux: one install has one of them.
    mcpConfigPaths: [
      'Library/Application Support/Claude/claude_desktop_config.json',
      '.config/Claude/claude_desktop_config.json',
    ],
  },
  {
    kind: DISCOVERED_AGENT_KIND.CURSOR,
    layoutVersion: '2026-08',
    configPaths: ['.cursor/mcp.json', '.cursor'],
    clients: ['Cursor'],
    inherentSurfaces: [SURFACE_KIND.SHELL, SURFACE_KIND.FILESYSTEM, SURFACE_KIND.NETWORK],
    mcpConfigPaths: ['.cursor/mcp.json'],
  },
  {
    kind: DISCOVERED_AGENT_KIND.CLINE,
    layoutVersion: '2026-08',
    configPaths: ['.cline/settings.json'],
    clients: ['Cline'],
    inherentSurfaces: [SURFACE_KIND.SHELL, SURFACE_KIND.FILESYSTEM],
    mcpConfigPaths: ['.cline/settings.json'],
  },
  {
    kind: DISCOVERED_AGENT_KIND.VS_CODE,
    layoutVersion: '2026-08',
    configPaths: ['.vscode/mcp.json'],
    clients: ['VS Code'],
    inherentSurfaces: [SURFACE_KIND.FILESYSTEM, SURFACE_KIND.NETWORK],
    mcpConfigPaths: ['.vscode/mcp.json'],
  },
  {
    kind: DISCOVERED_AGENT_KIND.GEMINI_CLI,
    layoutVersion: '2026-10',
    configPaths: ['.gemini/settings.json'],
    clients: ['Gemini CLI'],
    inherentSurfaces: [SURFACE_KIND.SHELL, SURFACE_KIND.FILESYSTEM, SURFACE_KIND.NETWORK],
    mcpConfigPaths: ['.gemini/settings.json'],
  },
  {
    kind: DISCOVERED_AGENT_KIND.WINDSURF,
    layoutVersion: '2026-10',
    configPaths: ['.codeium/windsurf/mcp_config.json', '.codeium/windsurf'],
    clients: ['Windsurf'],
    inherentSurfaces: [SURFACE_KIND.SHELL, SURFACE_KIND.FILESYSTEM, SURFACE_KIND.NETWORK],
    mcpConfigPaths: ['.codeium/windsurf/mcp_config.json'],
  },
  {
    kind: DISCOVERED_AGENT_KIND.COPILOT_CLI,
    layoutVersion: '2026-10',
    configPaths: ['.copilot/mcp-config.json', '.copilot'],
    clients: ['GitHub Copilot CLI'],
    inherentSurfaces: [SURFACE_KIND.SHELL, SURFACE_KIND.FILESYSTEM, SURFACE_KIND.NETWORK],
    mcpConfigPaths: ['.copilot/mcp-config.json'],
  },
  {
    kind: DISCOVERED_AGENT_KIND.DEVIN,
    layoutVersion: '2026-10',
    configPaths: ['.config/devin/config.json', '.config/devin', '.devin'],
    clients: ['Devin'],
    inherentSurfaces: [SURFACE_KIND.SHELL, SURFACE_KIND.FILESYSTEM, SURFACE_KIND.NETWORK],
    mcpConfigPaths: ['.config/devin/mcp_config.json'],
  },
  {
    // Its servers sit under `mcp` in a shape of its own, so none is read from its config.
    kind: DISCOVERED_AGENT_KIND.OPENCODE,
    layoutVersion: '2026-10',
    configPaths: ['.config/opencode/opencode.json', '.config/opencode'],
    clients: ['OpenCode'],
    inherentSurfaces: [SURFACE_KIND.SHELL, SURFACE_KIND.FILESYSTEM, SURFACE_KIND.NETWORK],
  },
];

/**
 * Products whose config the data-driven JSON reader would find nothing in: Codex is TOML,
 * Hermes is YAML, OpenClaw is JSON with comments, and Ruflo sits beside the work.
 */
const PARSING_DETECTORS: readonly AgentDetector[] = [
  new CodexDetector(),
  new HermesDetector(),
  new OpenClawDetector(),
  new RufloDetector(),
];

export const DEFAULT_DETECTORS: readonly AgentDetector[] = [
  ...DETECTOR_SPECS.map((spec) => new ConfigDetector(spec)),
  ...PARSING_DETECTORS,
];

/**
 * A directory whose change means an agent's reach may have changed. A directory rather
 * than a file, because a config that does not exist yet is the arrival worth catching.
 */
export interface WatchTarget {
  path: string;
  /** Entries directly inside `path` worth waking for; absent watches all beneath it. */
  only?: readonly string[];
}

/**
 * What to watch for agent config changes. A parent every program shares is watched only
 * for the entries named in it, because watching home or `~/.config` whole is every file
 * the person owns, and on Linux it exhausts the inotify watch limit within minutes.
 */
export function watchablePaths(home: string): WatchTarget[] {
  const deep = new Set<string>();
  const shallow = new Map<string, Set<string>>();
  for (const spec of DETECTOR_SPECS) {
    for (const relative of [...spec.configPaths, ...(spec.mcpConfigPaths ?? [])]) {
      const parent = dirname(relative);
      if (!SHARED_CONFIG_PARENTS.includes(parent)) {
        deep.add(join(home, parent));
        continue;
      }
      const path = join(home, parent);
      const names = shallow.get(path) ?? new Set<string>();
      names.add(basename(relative));
      shallow.set(path, names);
    }
  }
  // A product with its own parser is not in the spec list, so its directory is added here.
  for (const relative of PARSED_CONFIG_DIRS) deep.add(join(home, relative));
  const targets: WatchTarget[] = [...deep].map((path) => ({ path }));
  for (const [path, names] of shallow) {
    if (!deep.has(path)) targets.push({ path, only: [...names].sort() });
  }
  return targets.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Directories the parsing detectors read, plus those definitions are installed into,
 * since either changes what an agent may do. `~/.claude` is covered by `.claude.json`.
 */
const PARSED_CONFIG_DIRS: readonly string[] = [
  '.hermes',
  '.openclaw',
  '.claude-flow',
  '.codex',
  '.gemini/agents',
  '.qwen/agents',
  '.zcode/agents',
  '.github/agents',
  '.copilot/agents',
  '.config/opencode/agents',
];

export * from './detector';
export * from './config-detector';
export * from './mcp-config';
export * from './yaml-block';
export * from './toml-tables';
export * from './codex-detector';
export * from './hermes-detector';
export * from './openclaw-detector';
export * from './ruflo-detector';
