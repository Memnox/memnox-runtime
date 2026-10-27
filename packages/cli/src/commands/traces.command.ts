import { homedir } from 'node:os';

import type { Command } from 'commander';

import { summarizeTrace, waterfall, type Span, type WaterfallRow } from '@memnox/core';

import type { CliContext } from '../cli-context';
import { otlpEndpoint, otlpHeaders, sendOtlp } from '../trace/otlp';
import { LAST_TRACE, recentTraces, traceNamed } from '../trace/traces';

/**
 * `memnox traces`: what ran, inside what, for how long, and what failed, for an agent's session
 * and for Memnox itself answering a person. `--otlp` sends a trace to Logfire or any
 * OpenTelemetry collector, and only then does anything leave the machine.
 */

const MOST_LISTED = 20;
/** Wide enough to tell a slow step from a quick one at a glance in any terminal. */
const BAR_WIDTH = 32;

interface TracesOptions {
  json?: boolean;
  otlp?: string | boolean;
  header: string[];
}

export function registerTracesCommand(
  program: Command,
  context: CliContext,
  home: () => string = homedir,
  env: NodeJS.ProcessEnv = process.env,
): void {
  program
    .command('traces')
    .description(
      'What ran, for how long and what failed: agent sessions and Memnox itself',
    )
    .argument('[id]', `a trace id, a session id, or "${LAST_TRACE}"`)
    .option('--json', 'machine-readable output')
    .option(
      '--otlp [endpoint]',
      'send the trace to Logfire or another OpenTelemetry collector',
    )
    .option(
      '--header <key=value>',
      'a header for --otlp, such as Authorization=...',
      collect,
      [],
    )
    .action(async (id: string | undefined, options: TracesOptions) => {
      if (id === undefined) return listTraces(context, home(), options);
      return showTrace(context, { home: home(), env }, id, options);
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function listTraces(
  context: CliContext,
  home: string,
  options: TracesOptions,
): Promise<void> {
  const traces = await recentTraces(home, MOST_LISTED);
  if (options.json === true) {
    context.out.json(traces);
    return;
  }
  context.flow.open('memnox traces');
  if (traces.length === 0) {
    context.flow.close(
      'Nothing traced yet. Ask the voice something, or name a session: memnox traces <session>.',
    );
    return;
  }
  context.flow.box(
    'Lately, newest first',
    traces.map((trace) => {
      const failed = trace.errors === 0 ? '' : `  ${trace.errors} failed`;
      const slowest =
        trace.slowest === undefined
          ? ''
          : `  slowest ${trace.slowest.name} ${seconds(trace.slowest.durationMs)}`;
      return `${trace.startAt.slice(11, 19)}  ${seconds(trace.totalMs).padStart(6)}  ${trace.name}${failed}${slowest}  ${trace.traceId}`;
    }),
  );
  context.flow.close(`${traces.length} traces. Open one with: memnox traces <id>`);
}

async function showTrace(
  context: CliContext,
  machine: { home: string; env: NodeJS.ProcessEnv },
  id: string,
  options: TracesOptions,
): Promise<void> {
  const { home, env } = machine;
  const spans = await traceNamed(home, id);
  if (spans.length === 0)
    throw new Error(`No trace or session called ${id} is on record.`);
  if (options.otlp !== undefined) return exportTrace(context, env, spans, options);
  const summary = summarizeTrace(spans);
  if (options.json === true) {
    context.out.json({ summary, spans });
    return;
  }
  const rows = waterfall(spans);
  const total = Math.max(1, ...rows.map((row) => row.offsetMs + row.durationMs));
  context.flow.open('memnox traces');
  context.flow.box(
    summary?.name ?? id,
    rows.map((row) => rowLine(row, total)),
  );
  const failed = (summary?.errors ?? 0) === 0 ? '' : `, ${summary?.errors} failed`;
  context.flow.close(
    `${seconds(summary?.totalMs ?? total)} in ${spans.length} steps${failed}`,
  );
}

async function exportTrace(
  context: CliContext,
  env: NodeJS.ProcessEnv,
  spans: readonly Span[],
  options: TracesOptions,
): Promise<void> {
  const endpoint = otlpEndpoint(
    typeof options.otlp === 'string' ? options.otlp : undefined,
    env,
  );
  if (endpoint === null) {
    throw new Error(
      'Name where to send it: --otlp <endpoint>, or set OTEL_EXPORTER_OTLP_ENDPOINT.',
    );
  }
  const sent = await sendOtlp(endpoint, otlpHeaders(options.header, env), spans);
  if (!sent.ok)
    throw new Error(`${endpoint} answered ${sent.status}, so the trace was not taken.`);
  context.flow.open('memnox traces');
  context.flow.close(`Sent ${spans.length} spans to ${endpoint}.`);
}

/** One step as a bar on the trace's clock, indented under what it ran inside. */
function rowLine(row: WaterfallRow, total: number): string {
  const from = Math.round((row.offsetMs / total) * BAR_WIDTH);
  const width = Math.max(1, Math.round((row.durationMs / total) * BAR_WIDTH));
  const bar =
    `${' '.repeat(from)}${'█'.repeat(Math.min(width, BAR_WIDTH - from))}`.padEnd(
      BAR_WIDTH,
    );
  const mark =
    row.span.status === 'error'
      ? ' failed'
      : row.span.status === 'refused'
        ? ' refused'
        : '';
  return `${bar}  ${seconds(row.durationMs).padStart(6)}  ${'  '.repeat(row.depth)}${row.span.name}${mark}`;
}

function seconds(ms: number): string {
  return ms < 1_000 ? `${ms}ms` : `${(ms / 1_000).toFixed(1)}s`;
}
