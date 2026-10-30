import { MCP_PROTOCOL_VERSION, type McpToolSummary } from '@memnox/core';
import { HttpUpstream, type RemoteServer } from '@memnox/proxy';

/**
 * Asking a remote server for its tools over the same upstream the proxy reaches it through, so a
 * test finds what an agent would. Run on request only, bounded by a timeout, and it never throws.
 */

const INITIALIZE_ID = 1;
const TOOLS_LIST_ID = 2;

/** Long enough for a server that has to wake, short enough for a person waiting on a card. */
const REMOTE_TEST_TIMEOUT_MS = 15_000;

interface RemoteToolsInput extends RemoteServer {
  name: string;
  /** Injected so a test answers without a network. */
  fetch?: typeof fetch;
}

/** The tools it listed, or the reason it listed none, by the server's name and never its headers. */
export async function remoteToolsOf(
  input: RemoteToolsInput,
): Promise<{ tools: McpToolSummary[] } | { error: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ error: `${input.name} did not list its tools in time.` }),
      REMOTE_TEST_TIMEOUT_MS,
    );
    function settle(outcome: { tools: McpToolSummary[] } | { error: string }): void {
      clearTimeout(timer);
      void upstream.close().finally(() => resolve(outcome));
    }
    const upstream = new HttpUpstream({
      url: input.url,
      headers: input.headers,
      name: input.name,
      // Each failure also comes back as an error reply, which is what this answers with.
      log: () => undefined,
      timeoutMs: REMOTE_TEST_TIMEOUT_MS,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      onLine: (line) => {
        const reply = replyOf(line);
        if (reply.error !== undefined) return settle({ error: reply.error });
        if (reply.id === INITIALIZE_ID) return listTools(upstream);
        if (reply.id === TOOLS_LIST_ID) settle({ tools: reply.tools });
      },
    });
    upstream.send(
      message({
        id: INITIALIZE_ID,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'memnox-hub', version: '1' },
        },
      }),
    );
  });
}

function listTools(upstream: HttpUpstream): void {
  upstream.send(message({ method: 'notifications/initialized' }));
  upstream.send(message({ id: TOOLS_LIST_ID, method: 'tools/list' }));
}

function message(fields: Record<string, unknown>): string {
  return `${JSON.stringify({ jsonrpc: '2.0', ...fields })}\n`;
}

interface Reply {
  id?: unknown;
  error?: string;
  tools: McpToolSummary[];
}

/** One line read loosely: its id, an error's message, and each tool's name and description. */
function replyOf(line: string): Reply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // A line that is not JSON answers nothing this conversation asked.
    return { tools: [] };
  }
  if (typeof parsed !== 'object' || parsed === null) return { tools: [] };
  // Cast is safe: each field read below is checked for its type first.
  const reply = parsed as {
    id?: unknown;
    error?: { message?: unknown };
    result?: unknown;
  };
  const error = reply.error === undefined ? undefined : String(reply.error.message);
  return {
    id: reply.id,
    ...(error === undefined ? {} : { error }),
    tools: toolsOf(reply.result),
  };
}

function toolsOf(result: unknown): McpToolSummary[] {
  if (typeof result !== 'object' || result === null) return [];
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool: unknown) => {
    if (typeof tool !== 'object' || tool === null) return [];
    // Cast is safe: name and description are checked to be strings before they are kept.
    const { name, description } = tool as { name?: unknown; description?: unknown };
    if (typeof name !== 'string') return [];
    return [{ name, ...(typeof description === 'string' ? { description } : {}) }];
  });
}
