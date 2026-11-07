/**
 * The control plane, as a guard reaches it: the rules, a question to a person, its answer,
 * the key that signs answers, and the record of what was decided. A port, so a test hands
 * in a fake and a guard never needs a network to be checked.
 */
import type { PublishedBundle } from '@memnox/core/engine';

import type { HeldAnswer, HeldStatusName } from './guard.constants';

/** A question to raise, carrying only names and a digest of the arguments, never the arguments. */
export interface HeldAsk {
  operation: string;
  target?: string;
  argsDigest: string;
  agent: string;
  sessionId: string;
  reason: string;
  /** Stable for the same call, so a retried or resumed call finds the question already raised. */
  operationId: string;
  waitMinutes: number;
  ruleId?: string;
}

export interface HeldRaised {
  id: string;
  expiresAt: string;
}

/** An answer the control plane signed, so it cannot be forged between it and the agent. */
export interface SignedAnswer {
  /** The exact bytes signed: a JSON object naming the call, the answer and the arguments' digest. */
  payload: string;
  signature: string;
  keyId: string;
}

export interface HeldState {
  id: string;
  status: HeldStatusName;
  answer?: HeldAnswer;
  by?: string;
  door?: string;
  ruleId?: string;
  signed?: SignedAnswer;
}

export interface BundleFetch {
  bundle: PublishedBundle;
  etag: string | null;
  /** `<keyId>:<base64 signature>` over `body`, or null where the plane sent none. */
  signature: string | null;
  body: string;
}

export interface CloudKey {
  keyId: string;
  /** Ed25519, as base64 SPKI DER. */
  publicKey: string;
}

/** One row of the record, in the shape the control plane's events route reads. */
export interface GuardRecord {
  kind: string;
  dedupKey: string;
  subjectId: string;
  actorType: 'agent';
  occurredAt: number;
  agentSessionId?: string;
  payload: Record<string, unknown>;
}

/** A reference the next reader opens through its own access, never the thing itself. */
export interface WorkRef {
  kind: string;
  id: string;
}

/** One piece of work a person pointed this agent at, as the control plane names it. */
export interface GuardWork {
  id: string;
  status: string;
  /** The tracker's issue, a reference and never a copy. */
  issue?: { source: string; externalId: string; url?: string; title?: string };
  /** The latest progress note, where there is one. */
  latest?: string;
}

export interface ProgressReport {
  workId: string;
  note: string;
  /** `active`, `blocked` or `done_claimed`; only a person closes work. */
  state?: string;
  refs?: readonly WorkRef[];
}

export interface HandoffAsk {
  workId: string;
  toProfile?: string;
  toPerson?: string;
  reason: string;
  refs?: readonly WorkRef[];
}

/** The cloud's MCP tool names for the agent's side of its work. */
export const WORK_TOOL = {
  MY_WORK: 'memnox_my_work',
  REPORT_PROGRESS: 'memnox_report_progress',
  REQUEST_HANDOFF: 'memnox_request_handoff',
} as const;

export interface CloudPort {
  /** The rules, or null where they are unchanged since `etag`. */
  bundle(etag: string | null): Promise<BundleFetch | null>;
  raise(ask: HeldAsk): Promise<HeldRaised>;
  /** Where a question stands, waiting up to `waitSeconds` for it to change. */
  status(id: string, waitSeconds: number): Promise<HeldState>;
  keys(): Promise<CloudKey[]>;
  record(rows: readonly GuardRecord[]): Promise<void>;
  /** Whether a person resumed this session at or after `sinceMs`. */
  resumedSince(sessionId: string, sinceMs: number): Promise<boolean>;
  /** The work a person pointed this agent at; absent on a port that cannot ask. */
  myWork?(): Promise<GuardWork[]>;
  reportProgress?(report: ProgressReport): Promise<void>;
  requestHandoff?(ask: HandoffAsk): Promise<void>;
}

export interface FetchCloudOptions {
  baseUrl: string;
  workspace: string;
  token: string;
  /** Injected, so a runtime with its own fetch, or a test, can supply one. */
  fetch?: typeof fetch;
}

/** The control plane over HTTPS with the agent's credential. Every failure throws, and the guard decides what that means. */
export class FetchCloud implements CloudPort {
  private readonly fetcher: typeof fetch;
  private rpcId = 0;

  constructor(private readonly options: FetchCloudOptions) {
    this.fetcher = options.fetch ?? fetch;
  }

  async bundle(etag: string | null): Promise<BundleFetch | null> {
    const response = await this.call('GET', this.workspacePath('/bundle'), undefined, {
      ...(etag === null ? {} : { 'if-none-match': `"${etag}"` }),
    });
    if (response.status === 304) return null;
    const body = await this.ok(response).text();
    const bundle = JSON.parse(body) as PublishedBundle;
    const tag = response.headers.get('etag');
    return {
      bundle,
      etag: tag === null ? bundle.hash : tag.replace(/^W\//, '').replace(/"/g, ''),
      signature: response.headers.get('x-memnox-signature'),
      body,
    };
  }

  async raise(ask: HeldAsk): Promise<HeldRaised> {
    const response = await this.call('POST', this.workspacePath('/held-calls'), ask);
    return (await this.ok(response).json()) as HeldRaised;
  }

  async status(id: string, waitSeconds: number): Promise<HeldState> {
    const path = this.workspacePath(
      `/held-calls/${encodeURIComponent(id)}?wait=${waitSeconds}`,
    );
    const response = await this.call('GET', path);
    return (await this.ok(response).json()) as HeldState;
  }

  async keys(): Promise<CloudKey[]> {
    const response = await this.call('GET', '/v1/keys');
    const body = (await this.ok(response).json()) as { keys?: CloudKey[] };
    return body.keys ?? [];
  }

  async resumedSince(sessionId: string, sinceMs: number): Promise<boolean> {
    const path = this.workspacePath(
      `/cloud-agents/sessions/${encodeURIComponent(sessionId)}/resumed?since=${sinceMs}`,
    );
    const body = (await this.ok(await this.call('GET', path)).json()) as {
      resumed?: unknown;
    };
    return body.resumed === true;
  }

  async record(rows: readonly GuardRecord[]): Promise<void> {
    if (rows.length === 0) return;
    const response = await this.call('POST', this.workspacePath('/events'), {
      events: rows,
    });
    this.ok(response);
  }

  async myWork(): Promise<GuardWork[]> {
    return worksOf(await this.tool(WORK_TOOL.MY_WORK, {}));
  }

  async reportProgress(report: ProgressReport): Promise<void> {
    await this.tool(WORK_TOOL.REPORT_PROGRESS, { ...report, refs: report.refs ?? [] });
  }

  async requestHandoff(ask: HandoffAsk): Promise<void> {
    await this.tool(WORK_TOOL.REQUEST_HANDOFF, { ...ask, refs: ask.refs ?? [] });
  }

  /** One call to the workspace's MCP door, its structured answer or its text read as JSON. */
  private async tool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.call('POST', this.workspacePath('/mcp'), {
      jsonrpc: '2.0',
      id: (this.rpcId += 1),
      method: 'tools/call',
      params: { name, arguments: args },
    });
    return toolResultOf(await this.ok(response).json());
  }

  private workspacePath(rest: string): string {
    return `/v1/workspaces/${encodeURIComponent(this.options.workspace)}${rest}`;
  }

  private call(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    return this.fetcher(new URL(path, this.options.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private ok(response: Response): Response {
    if (!response.ok) throw new Error(`The control plane answered ${response.status}.`);
    return response;
  }
}

/** The tool's answer, refused where the call failed, so a caller never reads an error as work. */
function toolResultOf(body: unknown): unknown {
  const reply = objectOf(body);
  if (reply['error'] !== undefined)
    throw new Error('The control plane refused the tool call.');
  const result = objectOf(reply['result']);
  if (result['isError'] === true)
    throw new Error(textOf(result) ?? 'The tool call failed.');
  if (result['structuredContent'] !== undefined) return result['structuredContent'];
  const text = textOf(result);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A tool that answered in words rather than JSON said nothing a caller can read as work.
    return undefined;
  }
}

function textOf(result: Record<string, unknown>): string | undefined {
  const content = result['content'];
  if (!Array.isArray(content)) return undefined;
  const first = objectOf(content[0]);
  return typeof first['text'] === 'string' ? first['text'] : undefined;
}

/** Work as the tool answered it, keeping only what reads as work. */
function worksOf(answer: unknown): GuardWork[] {
  const listed = Array.isArray(answer) ? answer : objectOf(answer)['work'];
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((each: unknown) => {
    const work = objectOf(each);
    const id = work['id'];
    const status = work['status'];
    if (typeof id !== 'string' || typeof status !== 'string') return [];
    const issue = issueOf(work['issue'] ?? work['target']);
    const latest = work['latest'];
    return [
      {
        id,
        status,
        ...(issue === undefined ? {} : { issue }),
        ...(typeof latest === 'string' ? { latest } : {}),
      },
    ];
  });
}

function issueOf(value: unknown): GuardWork['issue'] {
  const issue = objectOf(value);
  const { source, externalId, url, title } = issue;
  if (typeof source !== 'string' || typeof externalId !== 'string') return undefined;
  return {
    source,
    externalId,
    ...(typeof url === 'string' ? { url } : {}),
    ...(typeof title === 'string' ? { title } : {}),
  };
}

function objectOf(value: unknown): Record<string, unknown> {
  // Cast is safe: a plain object is checked for in the same expression.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
