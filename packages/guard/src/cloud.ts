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
    const response = await this.call('POST', this.workspacePath('/held'), ask);
    return (await this.ok(response).json()) as HeldRaised;
  }

  async status(id: string, waitSeconds: number): Promise<HeldState> {
    const path = this.workspacePath(
      `/held/${encodeURIComponent(id)}?wait=${waitSeconds}`,
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
