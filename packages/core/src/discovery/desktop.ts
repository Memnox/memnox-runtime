import { SURFACE_KIND } from './discovery.constants';
import { nameSegments, type McpTool, type Surface } from './surface';

/**
 * A server that moves the pointer and sees the screen gives its agent every window on the
 * machine through the platform's own input APIs, which no wrapper, proxy or kernel profile
 * here sits in front of, so it is its own surface rather than one more tool count.
 */

/** Words a tool that presses keys or moves the pointer carries in its name. */
const INPUT_WORDS: readonly string[] = [
  'click',
  'type',
  'press',
  'hotkey',
  'keypress',
  'drag',
  'scroll',
  'mouse',
  'keyboard',
  'cursor',
];

/** Words a tool that captures the screen or reads another window's controls carries. */
const SIGHT_WORDS: readonly string[] = [
  'screenshot',
  'screen',
  'accessibility',
  'window',
  'windows',
  'desktop',
  'display',
];

/** A browser driver clicks and captures too, inside one page, and the browser seam already holds it. */
const BROWSER_WORDS: readonly string[] = ['browser', 'page', 'tab', 'dom'];

function hasWord(segments: readonly string[], words: readonly string[]): boolean {
  return words.some((word) => segments.includes(word));
}

/** True when the tools include both a hand and an eye on the desktop, read from names alone. */
export function drivesDesktop(tools: readonly McpTool[]): boolean {
  let input = false;
  let sight = false;
  for (const tool of tools) {
    const segments = nameSegments(tool.name);
    if (hasWord(segments, BROWSER_WORDS)) continue;
    if (hasWord(segments, INPUT_WORDS)) input = true;
    if (hasWord(segments, SIGHT_WORDS)) sight = true;
  }
  return input && sight;
}

/**
 * One desktop surface per agent whose MCP servers drive the desktop, pointing at the file
 * that declared the server, so "who granted this" has the same answer as for the tools.
 */
export function desktopSurfacesIn(surfaces: readonly Surface[]): Surface[] {
  const found = new Map<string, Surface>();
  for (const surface of surfaces) {
    if (surface.kind !== SURFACE_KIND.MCP || found.has(surface.agentId)) continue;
    if (!drivesDesktop(surface.tools ?? [])) continue;
    found.set(surface.agentId, {
      agentId: surface.agentId,
      kind: SURFACE_KIND.DESKTOP,
      detectedFrom: surface.detectedFrom,
    });
  }
  return [...found.values()];
}
