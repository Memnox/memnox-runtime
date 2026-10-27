/**
 * What an outgoing payload carries that a team would not want leaving, read by shape with
 * no model. Every kind found also carries `sensitive`, so one rule can name them all.
 */
export * from './data-classification';
import {
  DATA_CLASSIFICATION,
  DATA_CLASSIFICATIONS,
  DATA_SENSITIVITY,
  SENSITIVITY_BY_NAME,
  type CompiledPattern,
  type DataPattern,
  type DataSensitivity,
  MOST_PATTERN_CHARS,
} from './data-classification';
import { isRecord, normalizeKey } from './sensitive-keys';
import { scanValue, type ScanState } from './sensitive-scan';
import { structuredIn } from './sensitive-text';

export interface OutgoingData {
  /** Every kind found, `sensitive` included, most specific first. */
  classifications: string[];
  sensitivity: DataSensitivity;
}

/** What one payload is classified as, in the one field a request carries it in. */
export function classificationLabel(data: OutgoingData): string {
  return data.classifications.join(',');
}

/** Every label a request's classification answers to, so `sensitive` holds on each kind. */
export function classificationsImpliedBy(label: string | undefined): string[] {
  if (label === undefined) return [];
  const labels = new Set(
    label
      .split(',')
      .map((each) => each.trim())
      .filter((each) => each !== ''),
  );
  if (labels.has(DATA_CLASSIFICATION.CUSTOMER_RECORD)) {
    labels.add(DATA_CLASSIFICATION.PERSONAL_DATA);
  }
  const known = new Set<string>([...DATA_CLASSIFICATIONS, ...configuredNames()]);
  if ([...labels].some((each) => known.has(each)))
    labels.add(DATA_CLASSIFICATION.SENSITIVE);
  return [...labels];
}

const configured = new Map<string, readonly CompiledPattern[]>();

/**
 * The patterns one source adds, as a policy file or the workspace's bundle, replacing what
 * that source said before. Process wide, since every seam in a process reads one config.
 */
export function setDataPatterns(source: string, patterns: readonly DataPattern[]): void {
  const compiled = patterns.flatMap((each) =>
    each.patterns.flatMap((pattern) => {
      const expression = compilePattern(pattern);
      return expression === null
        ? []
        : [{ classification: each.classification, expression }];
    }),
  );
  if (compiled.length === 0) configured.delete(source);
  else configured.set(source, compiled);
}

/** A pattern as it will be matched, or null where it cannot be, which the validator reports. */
export function compilePattern(pattern: string): RegExp | null {
  if (pattern.length === 0 || pattern.length > MOST_PATTERN_CHARS) return null;
  const regex = /^\/(.+)\/$/.exec(pattern);
  try {
    return regex === null
      ? new RegExp(`(?<![\\w-])${escapeRegex(pattern)}(?![\\w-])`, 'i')
      : new RegExp(regex[1] ?? '', 'i');
  } catch {
    // A regex that does not compile matches nothing rather than everything.
    return null;
  }
}

function configuredNames(): string[] {
  return [...configured.values()].flatMap((list) =>
    list.map((each) => each.classification),
  );
}

/** Most specific first, so the label a person reads names the worst of it. */
const ORDER: readonly string[] = [
  DATA_CLASSIFICATION.SECRET,
  DATA_CLASSIFICATION.HEALTH,
  DATA_CLASSIFICATION.GOVERNMENT_ID,
  DATA_CLASSIFICATION.FINANCIAL,
  DATA_CLASSIFICATION.CUSTOMER_RECORD,
  DATA_CLASSIFICATION.PERSONAL_DATA,
  DATA_CLASSIFICATION.CONFIDENTIAL,
  DATA_CLASSIFICATION.BULK_RECORDS,
  DATA_CLASSIFICATION.SOURCE_CODE,
];

/** What the payload carries that is sensitive, or null where it carries nothing. */
export function classifyOutgoingData(
  payload: unknown,
  extra: readonly DataPattern[] = [],
): OutgoingData | null {
  const state: ScanState = {
    chars: 0,
    record: false,
    kinds: new Set(),
    patterns: [
      ...[...configured.values()].flat(),
      ...extra.flatMap((each) =>
        each.patterns.flatMap((pattern) => {
          const expression = compilePattern(pattern);
          return expression === null
            ? []
            : [{ classification: each.classification, expression }];
        }),
      ),
    ],
  };
  const fields = scanValue(withoutDestinations(payload), 0, state);
  if (fields.size > 0) state.kinds.add(DATA_CLASSIFICATION.PERSONAL_DATA);
  if (state.record) state.kinds.add(DATA_CLASSIFICATION.CUSTOMER_RECORD);
  if (state.kinds.size === 0) return null;
  const rank = (kind: string): number => {
    const at = ORDER.indexOf(kind);
    return at === -1 ? ORDER.length : at;
  };
  const kinds = [...state.kinds].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const restricted = kinds.some(
    (kind) => SENSITIVITY_BY_NAME.get(kind) === DATA_SENSITIVITY.RESTRICTED,
  );
  return {
    classifications: [...kinds, DATA_CLASSIFICATION.SENSITIVE],
    sensitivity: restricted ? DATA_SENSITIVITY.RESTRICTED : DATA_SENSITIVITY.CONFIDENTIAL,
  };
}

/** Argument names that say where a payload goes rather than what it carries. */
const DESTINATION_KEYS: ReadonlySet<string> = new Set([
  'to',
  'cc',
  'bcc',
  'recipient',
  'recipients',
  'recipientemail',
  'sendto',
  'toemail',
  'emailto',
  'toaddress',
  'url',
  'uri',
  'endpoint',
  'webhook',
  'webhookurl',
  'callbackurl',
  'href',
  'host',
  'hostname',
]);

/**
 * Where a payload is going, read from its own arguments: the domain of each recipient
 * address, and the host of each URL or webhook. Empty where it names nowhere.
 */
export function destinationsOf(args: Readonly<Record<string, unknown>>): string[] {
  const found = new Set<string>();
  for (const [key, value] of Object.entries(args)) {
    if (!DESTINATION_KEYS.has(normalizeKey(key))) continue;
    for (const text of textsIn(value)) {
      for (const part of text.split(/[\s,;]+/)) {
        const destination = destinationOfText(part);
        if (destination !== undefined) found.add(destination);
      }
    }
  }
  return [...found];
}

/** The fields `withOutgoingData` reads and writes. */
export interface OutgoingRequest {
  target?: string;
  dataClassification?: string;
}

/**
 * The request, plus one per destination carrying the classification where its payload is
 * sensitive. A payload naming nowhere is classified where it stands: nowhere is not approved.
 */
export function withOutgoingData<Request extends OutgoingRequest>(
  request: Request,
  payload: unknown,
  destinations: readonly string[] = destinationsOfPayload(payload),
): Request[] {
  const data = classifyOutgoingData(payload);
  if (data === null) return [request];
  const dataClassification = classificationLabel(data);
  const named = destinations.filter((each) => each !== '');
  if (named.length === 0) return [{ ...request, dataClassification }];
  return [
    request,
    ...named.map((target) => ({ ...request, target, dataClassification })),
  ];
}

function destinationsOfPayload(payload: unknown): string[] {
  return isRecord(payload) ? destinationsOf(payload) : [];
}

function withoutDestinations(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !DESTINATION_KEYS.has(normalizeKey(key))),
  );
}

function destinationOfText(text: string): string | undefined {
  const cleaned = text.replace(/^[<"'([]+|[>"')\]]+$/g, '');
  if (cleaned === '') return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)) {
    try {
      const host = new URL(cleaned).hostname.toLowerCase();
      return host === '' ? undefined : host;
    } catch {
      // An address that does not parse names no host.
      return undefined;
    }
  }
  const at = cleaned.lastIndexOf('@');
  if (at > 0) return cleaned.slice(at + 1).toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(cleaned) ? cleaned.toLowerCase() : undefined;
}

function textsIn(value: unknown): string[] {
  if (typeof value === 'string') {
    const structured = value.trim().startsWith('[') ? structuredIn(value.trim()) : null;
    return structured === null ? [value] : textsIn(structured);
  }
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (isRecord(value)) {
    // `{ email: "..." }` or `{ address: "..." }`, the shape a mail API gives a recipient.
    return Object.values(value).filter(
      (each): each is string => typeof each === 'string',
    );
  }
  return [];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
