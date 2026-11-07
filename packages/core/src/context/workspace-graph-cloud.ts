/**
 * The control plane's `GET :ws/graph` answer, read field by field rather than trusted, since it
 * crosses the network. Only the part a memory picture draws is kept.
 */

import type { WorkspaceSaid } from './workspace-graph';

/** The part of the cloud's `GraphView` this reads. */
export interface CloudGraph {
  nodes: CloudNode[];
  edges: CloudEdge[];
  withheld: number;
  truncated: boolean;
}

export interface CloudNode {
  ref: string;
  /** The cloud's ref kind: item, passage, person, handle, fact and the rest. */
  kind: string;
  label: string;
  href?: string;
  excerpt?: string;
  system?: string;
  repeats?: number;
  messages?: number;
  app: boolean;
  said: WorkspaceSaid[];
  degree: number;
}

export interface CloudEdge {
  fromRef: string;
  toRef: string;
  kind: string;
  basis?: string;
}

/** A ref is its kind, a colon, and its id. */
const REF_SEPARATOR = ':';

/** The graph in the answer, or null for an answer that is not one. */
export function parseCloudGraph(body: unknown): CloudGraph | null {
  const raw = objectOr(body);
  if (raw === null || !Array.isArray(raw['nodes']) || !Array.isArray(raw['edges']))
    return null;
  return {
    nodes: raw['nodes'].flatMap(cloudNodeOf),
    edges: raw['edges'].flatMap(cloudEdgeOf),
    withheld: countOr(raw['withheld']),
    truncated: raw['truncated'] === true,
  };
}

function cloudNodeOf(raw: unknown): CloudNode[] {
  const node = objectOr(raw);
  if (node === null) return [];
  const ref = textOr(node['ref']);
  if (ref === undefined) return [];
  return [
    {
      ref,
      kind: textOr(node['kind']) ?? ref.split(REF_SEPARATOR, 1)[0] ?? '',
      label: textOr(node['label']) ?? ref,
      app: node['app'] === true,
      said: Array.isArray(node['said']) ? node['said'].flatMap(saidOf) : [],
      degree: countOr(node['degree']),
      ...optionalText(node, 'href'),
      ...optionalText(node, 'excerpt'),
      ...optionalText(node, 'system'),
      ...optionalCount(node, 'repeats'),
      ...optionalCount(node, 'messages'),
    },
  ];
}

function saidOf(raw: unknown): WorkspaceSaid[] {
  const said = objectOr(raw);
  if (said === null) return [];
  const label = textOr(said['label']);
  if (label === undefined) return [];
  const at = said['at'];
  return [
    {
      label,
      ...optionalText(said, 'href'),
      ...optionalText(said, 'excerpt'),
      // The cloud writes epoch milliseconds; the wire to a screen is ISO, as every other time is.
      ...(typeof at === 'number' && Number.isFinite(at)
        ? { at: new Date(at).toISOString() }
        : {}),
    },
  ];
}

function cloudEdgeOf(raw: unknown): CloudEdge[] {
  const edge = objectOr(raw);
  if (edge === null) return [];
  const fromRef = textOr(edge['fromRef']);
  const toRef = textOr(edge['toRef']);
  const kind = textOr(edge['kind']);
  if (fromRef === undefined || toRef === undefined || kind === undefined) return [];
  return [{ fromRef, toRef, kind, ...optionalText(edge, 'basis') }];
}

function optionalText<K extends string>(
  raw: Record<string, unknown>,
  key: K,
): Partial<Record<K, string>> {
  const text = textOr(raw[key]);
  // Cast is safe: the one key written is the key asked for.
  return text === undefined ? {} : ({ [key]: text } as Record<K, string>);
}

function optionalCount<K extends string>(
  raw: Record<string, unknown>,
  key: K,
): Partial<Record<K, number>> {
  const count = countOr(raw[key]);
  // Cast is safe: the one key written is the key asked for.
  return count === 0 ? {} : ({ [key]: count } as Record<K, number>);
}

function objectOr(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function countOr(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}
