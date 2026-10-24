import { dirname, join } from 'node:path';
import { DISCOVERED_AGENT_KIND, SURFACE_KIND } from '../discovery.constants';
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
    mcpConfigPath: '.gemini/settings.json',
  },
  {
    kind: DISCOVERED_AGENT_KIND.WINDSURF,
    layoutVersion: '2026-10',
    configPaths: ['.codeium/windsurf/mcp_config.json', '.codeium/windsurf'],
    clients: ['Windsurf'],
    inherentSurfaces: [SURFACE_KIND.SHELL, SURFACE_KIND.FILESYSTEM, SURFACE_KIND.NETWORK],
    mcpConfigPath: '.codeium/windsurf/mcp_config.json',
  },
  {
    kind: DISCOVERED_AGENT_KIND.COPILOT_CLI,
    layoutVersion: '2026-10',
    configPaths: ['.copilot/mcp-config.json', '.copilot'],
    clients: ['GitHub Copilot CLI'],
    inherentSurfaces: [SURFACE_KIND.SHELL, SURFACE_KIND.FILESYSTEM, SURFACE_KIND.NETWORK],
    mcpConfigPath: '.copilot/mcp-config.json',
  },
  {
    kind: DISCOVERED_AGENT_KIND.DEVIN,
    layoutVersion: '2026-10',
    configPaths: ['.config/devin/config.json', '.config/devin', '.devin'],
    clients: ['Devin'],
    inherentSurfaces: [SURFACE_KIND.SHELL, SURFACE_KIND.FILESYSTEM, SURFACE_KIND.NETWORK],
    mcpConfigPath: '.config/devin/mcp_config.json',
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
 * The directories whose change means an agent's reach may have changed. Directories,
 * because a config that does not exist yet cannot be watched and is the case worth catching.
 */
export function watchablePaths(home: string): string[] {
  const paths = new Set<string>();
  for (const spec of DETECTOR_SPECS) {
    for (const relative of spec.configPaths) {
      paths.add(relative.includes('/') ? dirname(join(home, relative)) : home);
    }
  }
  // A product with its own parser is not in the spec list, so its directory is added here.
  for (const relative of PARSED_CONFIG_DIRS) paths.add(join(home, relative));
  return [...paths].sort();
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
