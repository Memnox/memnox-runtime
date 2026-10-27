import { describe, expect, it } from 'vitest';
import { desktopSurfacesIn, drivesDesktop } from '../src/discovery/desktop';
import { discover } from '../src/discovery/discover';
import { SURFACE_KIND } from '../src/discovery/discovery.constants';
import type { McpLister } from '../src/discovery/ports';
import type { McpTool, Surface } from '../src/discovery/surface';
import { FakeMachine } from './fake-machine';

const NOW = '2026-10-13T09:00:00.000Z';

const tools = (names: string[]): McpTool[] =>
  names.map((name) => ({ server: 's', name, effect: 'unknown', inferredFrom: 'name' }));

describe('a server that drives the desktop', () => {
  it('is one that has both a hand and an eye, read from tool names alone', () => {
    expect(
      drivesDesktop(
        tools([
          'click',
          'type_text',
          'press_key',
          'screenshot',
          'get_accessibility_tree',
        ]),
      ),
    ).toBe(true);
    expect(drivesDesktop(tools(['clickScreen', 'takeScreenshot', 'moveMouse']))).toBe(
      true,
    );
  });

  it('is not one that only clicks, or only looks', () => {
    expect(drivesDesktop(tools(['click', 'type_text', 'hotkey']))).toBe(false);
    expect(drivesDesktop(tools(['screenshot', 'list_windows']))).toBe(false);
  });

  /* A browser driver clicks and captures inside one page, and the browser seam already
     holds it. Reporting it as the desktop would double the count and name the wrong seam. */
  it('leaves a browser driver to the browser seam', () => {
    expect(
      drivesDesktop(
        tools([
          'browser_click',
          'browser_type',
          'browser_take_screenshot',
          'browser_tab',
        ]),
      ),
    ).toBe(false);
  });

  it('adds one desktop surface per agent, pointing at the file that declared the server', () => {
    const mcp: Surface = {
      agentId: 'agt_claude-code',
      kind: SURFACE_KIND.MCP,
      detectedFrom: '/home/dev/.claude.json',
      tools: tools(['click', 'screenshot']),
      servers: [],
    };
    const again: Surface = { ...mcp, detectedFrom: '/work/.mcp.json' };
    const other: Surface = {
      agentId: 'agt_cursor',
      kind: SURFACE_KIND.MCP,
      detectedFrom: '/home/dev/.cursor/mcp.json',
      tools: tools(['get_issue']),
      servers: [],
    };

    expect(desktopSurfacesIn([mcp, again, other])).toEqual([
      {
        agentId: 'agt_claude-code',
        kind: SURFACE_KIND.DESKTOP,
        detectedFrom: '/home/dev/.claude.json',
      },
    ]);
  });
});

describe('the desktop in a scan', () => {
  const machine = (): FakeMachine =>
    FakeMachine.from({
      '/home/dev/.claude.json': JSON.stringify({
        mcpServers: { computer: { command: 'computer-driver', args: ['mcp'] } },
      }),
    });

  const lister: McpLister = {
    listTools: async () => [
      { name: 'click' },
      { name: 'type_text' },
      { name: 'screenshot' },
      { name: 'get_window_state' },
    ],
  };

  it('is a surface of the agent whose config declares the server', async () => {
    const report = await discover(machine(), { now: NOW, lister });
    const desktop = report.surfaces.filter((each) => each.kind === SURFACE_KIND.DESKTOP);

    expect(desktop).toEqual([
      {
        agentId: 'agt_claude-code',
        kind: SURFACE_KIND.DESKTOP,
        detectedFrom: '/home/dev/.claude.json',
      },
    ]);
  });

  it('is absent when no server was asked, since a config never says what a server does', async () => {
    const report = await discover(machine(), { now: NOW });

    expect(report.surfaces.some((each) => each.kind === SURFACE_KIND.DESKTOP)).toBe(
      false,
    );
  });
});
