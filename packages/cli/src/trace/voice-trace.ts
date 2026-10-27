import { join } from 'node:path';
import {
  MEMNOX_HOME,
  newSpanId,
  newTraceId,
  readJsonFile,
  SPAN_KIND,
  SPAN_STATUS,
  TraceStore,
  TRACES_DIR,
  writeJsonFile,
  type DaemonAskChunk,
  type Span,
  type SpanKind,
  type SpanStatus,
  type SpanValue,
} from '@memnox/core';

/**
 * Memnox answering a person as one trace. The trace in progress is named in a small file, so the
 * operator's tools in the brain's process, and the Mac, hang their spans on the same trace.
 */

const CURRENT_FILE = 'current.json';

/** A pointer older than this belongs to a question already answered, not the one now. */
const CURRENT_FOR_MS = 120_000;

/** The trace being answered now, as other processes find it. */
interface CurrentTrace {
  traceId: string;
  /** The whole turn, which the Mac's spans hang under. */
  rootId: string;
  /** The brain's turn, which the operator's tool calls hang under. */
  brainId: string;
  at: string;
}

function currentPath(home: string): string {
  return join(home, MEMNOX_HOME, TRACES_DIR, CURRENT_FILE);
}

/** The trace in progress, or null when nobody is being answered. */
async function currentTrace(home: string, moment: string): Promise<CurrentTrace | null> {
  const current = await readJsonFile<CurrentTrace>(currentPath(home));
  if (current === null) return null;
  return Date.parse(moment) - Date.parse(current.at) < CURRENT_FOR_MS ? current : null;
}

/** A span hung on whatever trace is in progress, or on a trace of its own when none is. */
export async function recordSpan(
  home: string,
  span: {
    name: string;
    kind: SpanKind;
    startAt: string;
    endAt: string;
    status: SpanStatus;
    attributes: Record<string, SpanValue>;
    error?: string;
    under: 'root' | 'brain';
  },
): Promise<void> {
  const current = await currentTrace(home, span.startAt);
  const { under, ...rest } = span;
  const parent =
    current === null ? undefined : under === 'root' ? current.rootId : current.brainId;
  await new TraceStore(home).append([
    {
      ...rest,
      traceId: current?.traceId ?? newTraceId(),
      spanId: newSpanId(),
      ...(parent === undefined ? {} : { parentId: parent }),
    },
  ]);
}

/** One question to the voice, timed as it goes and written down once it ends. */
export class VoiceTurnTrace {
  private readonly traceId = newTraceId();
  private readonly rootId = newSpanId();
  private readonly brainId = newSpanId();
  private readonly startAt: string;
  private contextSpan: Span | null = null;
  private brainStart: string | null = null;
  private firstWordAt: string | null = null;
  private readonly tools: { name: string; startAt: string; endAt?: string }[] = [];
  private ending: string = 'done';

  constructor(
    private readonly home: string,
    private readonly now: () => string,
    private readonly words: number,
  ) {
    this.startAt = now();
  }

  /** The session list put in front of the question, and how long building it took. */
  contextBuilt(startAt: string, sessions: number): void {
    this.contextSpan = this.span(
      this.rootId,
      'voice.context',
      SPAN_KIND.VOICE,
      startAt,
      this.now(),
      SPAN_STATUS.OK,
      { sessions },
    );
  }

  /** The brain starts now, and its tools find this trace from here on. */
  async brainStarted(): Promise<void> {
    this.brainStart = this.now();
    const current: CurrentTrace = {
      traceId: this.traceId,
      rootId: this.rootId,
      brainId: this.brainId,
      at: this.brainStart,
    };
    await writeJsonFile(currentPath(this.home), current).catch(() => undefined);
  }

  /** Each chunk as it streams: the first words, and a tool running until the next chunk arrives. */
  chunk(chunk: DaemonAskChunk): void {
    const at = this.now();
    const open = this.tools[this.tools.length - 1];
    if (open !== undefined && open.endAt === undefined) open.endAt = at;
    if (chunk.kind === 'tool' && chunk.tool !== undefined)
      this.tools.push({ name: toolName(chunk.tool), startAt: at });
    if (
      chunk.kind === 'text' &&
      this.firstWordAt === null &&
      (chunk.text ?? '').trim() !== ''
    )
      this.firstWordAt = at;
    if (chunk.kind !== 'text' && chunk.kind !== 'tool') this.ending = chunk.kind;
  }

  async finish(): Promise<void> {
    const endAt = this.now();
    const failed = this.ending === 'failed' || this.ending === 'limited';
    const status = failed ? SPAN_STATUS.ERROR : SPAN_STATUS.OK;
    const spans: Span[] = [
      this.rootSpan(endAt, status),
      ...(this.contextSpan === null ? [] : [this.contextSpan]),
      this.brainSpan(endAt, status),
      ...this.tools.map((tool) =>
        this.span(
          this.brainId,
          `brain.${tool.name}`,
          SPAN_KIND.TOOL,
          tool.startAt,
          tool.endAt ?? endAt,
          SPAN_STATUS.OK,
          {},
        ),
      ),
    ];
    await new TraceStore(this.home).append(spans).catch(() => undefined);
  }

  /** The whole answer, from the question to its last chunk, and how soon the first word came. */
  private rootSpan(endAt: string, status: SpanStatus): Span {
    return this.span(
      undefined,
      'voice.turn',
      SPAN_KIND.VOICE,
      this.startAt,
      endAt,
      status,
      {
        words: this.words,
        ending: this.ending,
        ...this.firstWordAfter(this.startAt),
      },
      this.rootId,
    );
  }

  private brainSpan(endAt: string, status: SpanStatus): Span {
    const startAt = this.brainStart ?? endAt;
    return this.span(
      this.rootId,
      'brain.turn',
      SPAN_KIND.BRAIN,
      startAt,
      endAt,
      status,
      {
        tools: this.tools.length,
        ...this.firstWordAfter(startAt),
      },
      this.brainId,
    );
  }

  private firstWordAfter(from: string): Record<string, SpanValue> {
    return this.firstWordAt === null
      ? {}
      : { firstWordMs: Date.parse(this.firstWordAt) - Date.parse(from) };
  }

  private span(
    parentId: string | undefined,
    name: string,
    kind: SpanKind,
    startAt: string,
    endAt: string,
    status: SpanStatus,
    attributes: Record<string, SpanValue>,
    spanId: string = newSpanId(),
  ): Span {
    return {
      traceId: this.traceId,
      spanId,
      ...(parentId === undefined ? {} : { parentId }),
      name,
      kind,
      startAt,
      endAt,
      status,
      attributes,
    };
  }
}

/** `mcp__memnox-operator__sessions` as the tool's own name. */
function toolName(tool: string): string {
  return tool.split('__').pop() ?? tool;
}
