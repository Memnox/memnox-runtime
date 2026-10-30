import {
  McpMemorySource,
  SupermemorySource,
  SUPERMEMORY_URL,
  type McpMemoryCall,
} from './api-sources';
import { folderSource } from './folder-sources';
import {
  MEMORY_SOURCE_KIND,
  type MemorySource,
  type MemorySourceRecord,
} from './memory-source';

/** A source record turned into the reader for its kind, with whatever reaches outside injected. */

export interface SourceReach {
  /** The OS store's lookup, for a source that names a key. */
  secret: (name: string) => Promise<string | undefined>;
  fetch: typeof fetch;
  /** Reaches a hub server's tool; absent where there is no hub to reach. */
  mcp?: (server: string, tool: string) => McpMemoryCall;
}

/** The tool the reference MCP memory server reads its whole graph with. */
export const DEFAULT_MCP_MEMORY_TOOL = 'read_graph';

/** Null where the record cannot be read: an MCP source with no hub, or a kind nothing reads. */
export function memorySourceFor(
  record: MemorySourceRecord,
  reach: SourceReach,
): MemorySource | null {
  switch (record.kind) {
    case MEMORY_SOURCE_KIND.SUPERMEMORY: {
      const secret = record.secret;
      return new SupermemorySource({
        baseUrl:
          record.location === '' ? SUPERMEMORY_URL : record.location.replace(/\/+$/, ''),
        key: () =>
          secret === undefined ? Promise.resolve(undefined) : reach.secret(secret),
        fetch: reach.fetch,
      });
    }
    case MEMORY_SOURCE_KIND.MCP:
      if (reach.mcp === undefined || record.server === undefined) return null;
      return new McpMemorySource(
        reach.mcp(record.server, record.tool ?? DEFAULT_MCP_MEMORY_TOOL),
      );
    default:
      return folderSource(record.kind, record.location);
  }
}
