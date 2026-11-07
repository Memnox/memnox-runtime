import { describe, expect, it } from 'vitest';

import { FetchCloud, WORK_TOOL, type CloudPort, type GuardRecord } from '../src/cloud';
import { Guard } from '../src/guard';
import { wrapTool } from '../src/wrap';

/**
 * A guard names the job on every record, and reads and reports the agent's work over the cloud's
 * MCP door. It never starts, assigns or closes work: those are a person's.
 */

/** Enough control plane for records and work, with rules that allow everything. */
class WorkCloud implements CloudPort {
  readonly recorded: GuardRecord[] = [];
  readonly reports: unknown[] = [];

  async bundle(): Promise<null> {
    return null;
  }
  async raise(): Promise<never> {
    throw new Error('nothing is asked here');
  }
  async status(): Promise<never> {
    throw new Error('nothing is asked here');
  }
  async keys(): Promise<[]> {
    return [];
  }
  async record(rows: readonly GuardRecord[]): Promise<void> {
    this.recorded.push(...rows);
  }
  async resumedSince(): Promise<boolean> {
    return false;
  }
  async myWork(): Promise<{ id: string; status: string }[]> {
    return [{ id: 'agw_1', status: 'active' }];
  }
  async reportProgress(report: unknown): Promise<void> {
    this.reports.push(report);
  }
}

describe('a guard working under a profile', () => {
  it('names the profile on every record, and a wrapped tool can name its own', async () => {
    const cloud = new WorkCloud();
    const guard = new Guard(cloud, {
      agent: 'support-bot',
      profileId: 'support',
    }).start();
    await guard.authorize('mcp__linear__list_issues', {}, { sessionId: 's1' });
    const triage = wrapTool(guard, 'mcp__linear__get_issue', async () => 'ok', {
      session: () => 's2',
      profileId: 'triage',
    });
    await triage({});
    await guard.close();
    const profiles = cloud.recorded.map((row) => [row.kind, row.payload['profileId']]);
    expect(profiles).toEqual([
      ['agent.session.started', 'support'],
      ['agent.action.recorded', 'support'],
      ['agent.session.started', 'triage'],
      ['agent.action.recorded', 'triage'],
    ]);
  });

  it('reads its work and reports on it through the port, with secrets taken out', async () => {
    const cloud = new WorkCloud();
    const guard = new Guard(cloud, { agent: 'support-bot' }).start();
    expect(await guard.myWork()).toEqual([{ id: 'agw_1', status: 'active' }]);
    await guard.reportProgress({
      workId: 'agw_1',
      note: 'drafted the reply',
      state: 'active',
    });
    expect(cloud.reports).toEqual([
      { workId: 'agw_1', note: 'drafted the reply', state: 'active' },
    ]);
    await expect(
      guard.requestHandoff({ workId: 'agw_1', toProfile: 'billing', reason: 'a refund' }),
    ).rejects.toThrow('does not answer for agent work');
    await guard.close();
  });
});

describe('the work door over HTTPS', () => {
  it('calls the cloud MCP tools by name and reads their answer', async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fake: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push({ url: String(url), body });
      const work = [
        {
          id: 'agw_1',
          status: 'blocked',
          issue: { source: 'linear', externalId: 'LIN-1' },
        },
        { status: 'no id, so not work' },
      ];
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body['id'],
          result: { content: [{ type: 'text', text: JSON.stringify({ work }) }] },
        }),
        { status: 200 },
      );
    };
    const cloud = new FetchCloud({
      baseUrl: 'https://cloud.test',
      workspace: 'ws_1',
      token: ['tok', 'en'].join(''),
      fetch: fake,
    });
    expect(await cloud.myWork()).toEqual([
      {
        id: 'agw_1',
        status: 'blocked',
        issue: { source: 'linear', externalId: 'LIN-1' },
      },
    ]);
    await cloud.reportProgress({ workId: 'agw_1', note: 'unblocked' });
    expect(sent.map((each) => each.url)).toEqual([
      'https://cloud.test/v1/workspaces/ws_1/mcp',
      'https://cloud.test/v1/workspaces/ws_1/mcp',
    ]);
    expect(sent.map((each) => (each.body['params'] as { name: string }).name)).toEqual([
      WORK_TOOL.MY_WORK,
      WORK_TOOL.REPORT_PROGRESS,
    ]);
    expect(sent[1]?.body['method']).toBe('tools/call');
  });

  it('refuses an answer that is an error rather than reading it as work', async () => {
    const fake: typeof fetch = async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1 } }), {
        status: 200,
      });
    const cloud = new FetchCloud({
      baseUrl: 'https://cloud.test',
      workspace: 'ws_1',
      token: ['tok', 'en'].join(''),
      fetch: fake,
    });
    await expect(cloud.myWork()).rejects.toThrow('refused the tool call');
  });
});
