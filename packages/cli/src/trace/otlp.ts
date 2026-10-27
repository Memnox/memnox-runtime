import { createHash } from 'node:crypto';
import { SPAN_STATUS, type Span, type SpanValue } from '@memnox/core';

/**
 * Spans as OpenTelemetry's OTLP/JSON, which Logfire, Honeycomb, Grafana Tempo and any collector
 * read. Sent only when a person asks, to the address they name, and never with a value Memnox
 * does not already keep: names, timings, decisions and paths, never output or what was said.
 */

/** Where traces go when a person set the standard OpenTelemetry variables and named no address. */
const ENDPOINT_VAR = 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT';
const BASE_ENDPOINT_VAR = 'OTEL_EXPORTER_OTLP_ENDPOINT';
const HEADERS_VAR = 'OTEL_EXPORTER_OTLP_HEADERS';

const SERVICE = 'memnox';

/** OTLP's status codes: unset, ok, error. A refusal is a decision working, so it is ok. */
const STATUS_CODE = { OK: 1, ERROR: 2 } as const;
/** Every Memnox span is internal: nothing here is a server answering a request. */
const INTERNAL_KIND = 1;

interface OtlpAttribute {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: string }
    | { doubleValue: number }
    | { boolValue: boolean };
}

interface OtlpPayload {
  resourceSpans: {
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: { scope: { name: string }; spans: unknown[] }[];
  }[];
}

export function toOtlp(spans: readonly Span[]): OtlpPayload {
  return {
    resourceSpans: [
      {
        resource: { attributes: [attribute('service.name', SERVICE)] },
        scopeSpans: [{ scope: { name: SERVICE }, spans: spans.map(otlpSpan) }],
      },
    ],
  };
}

function otlpSpan(span: Span): unknown {
  const traceId = hexOf(span.traceId, 32);
  return {
    traceId,
    spanId: hexOf(`${span.traceId}/${span.spanId}`, 16, span.spanId),
    ...(span.parentId === undefined
      ? {}
      : { parentSpanId: hexOf(`${span.traceId}/${span.parentId}`, 16, span.parentId) }),
    name: span.name,
    kind: INTERNAL_KIND,
    startTimeUnixNano: nanos(span.startAt),
    endTimeUnixNano: nanos(span.endAt),
    attributes: [
      attribute('memnox.kind', span.kind),
      attribute('memnox.status', span.status),
      ...Object.entries(span.attributes).map(([key, value]) =>
        attribute(`memnox.${key}`, value),
      ),
    ],
    status:
      span.status === SPAN_STATUS.ERROR
        ? { code: STATUS_CODE.ERROR, message: span.error ?? 'failed' }
        : { code: STATUS_CODE.OK },
  };
}

/** An id already the size OTLP wants is kept; anything else is hashed to it, the same way every time. */
function hexOf(seed: string, length: number, own: string = seed): string {
  if (new RegExp(`^[0-9a-f]{${length}}$`).test(own)) return own;
  return createHash('sha256').update(seed).digest('hex').slice(0, length);
}

function nanos(moment: string): string {
  return `${BigInt(Date.parse(moment)) * 1_000_000n}`;
}

function attribute(key: string, value: SpanValue): OtlpAttribute {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: value } };
}

/** The address a person named, else the standard variable, else nothing: there is no default destination. */
export function otlpEndpoint(
  named: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  if (named !== undefined && named !== '') return named;
  const traces = env[ENDPOINT_VAR];
  if (traces !== undefined && traces !== '') return traces;
  const base = env[BASE_ENDPOINT_VAR];
  return base === undefined || base === ''
    ? null
    : `${base.replace(/\/$/, '')}/v1/traces`;
}

/** `Authorization=Bearer x,Other=y`, the standard variable's format, plus any given on the command line. */
export function otlpHeaders(
  given: readonly string[],
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const pairs = [...(env[HEADERS_VAR]?.split(',') ?? []), ...given];
  const headers: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    headers[decodeURIComponent(pair.slice(0, at).trim())] = decodeURIComponent(
      pair.slice(at + 1).trim(),
    );
  }
  return headers;
}

export async function sendOtlp(
  endpoint: string,
  headers: Record<string, string>,
  spans: readonly Span[],
  send: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number }> {
  const response = await send(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(toOtlp(spans)),
  });
  return { ok: response.ok, status: response.status };
}
