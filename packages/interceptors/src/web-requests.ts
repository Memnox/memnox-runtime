import { HTTP_METHOD, HTTP_METHOD_ARGUMENT, TOOL_CLASS } from '@memnox/core';

import { firstText, type HookFields } from './hook-payload';
import type { ToolRequest } from './tool-calls';
import { EGRESS_REQUEST_ACTION } from './tool-hook.constants';

/** What an agent's own fetch and search tools reach, read as the requests a rule names. */

const FETCH_TOOLS: readonly string[] = ['WebFetch', 'web_fetch'];
/** Hermes's fetch, which reads several pages in one call under `urls`. */
const FETCH_MANY_TOOL = 'web_extract';
const WEB_SEARCH_TOOLS: readonly string[] = [
  'WebSearch',
  'google_web_search',
  'web_search',
];
/** A URL inside free text, which is where Gemini's fetch tool carries its address. */
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/;

/** The requests a web tool makes, or undefined where this is not a web tool. */
export function webRequests(
  tool: string,
  input: HookFields,
): ToolRequest[] | null | undefined {
  if (FETCH_TOOLS.includes(tool)) return [fetchRequest(input)];
  if (tool === FETCH_MANY_TOOL) {
    const urls = Array.isArray(input['urls']) ? input['urls'] : [];
    const each = urls.filter((url): url is string => typeof url === 'string');
    return each.length === 0 ? null : each.map((url) => fetchRequest({ url }));
  }
  if (WEB_SEARCH_TOOLS.includes(tool)) return [searchRequest(input)];
  return undefined;
}

/** A fetch by its host, which is what a network rule names; the URL is inspected too. */
function fetchRequest(input: HookFields): ToolRequest {
  const text = firstText(input, ['url', 'prompt']) ?? '';
  const found = URL_IN_TEXT.exec(text);
  const url = found === null ? undefined : found[0];
  const host = url === undefined ? undefined : hostOf(url);
  return {
    action: EGRESS_REQUEST_ACTION,
    ...(host === undefined ? {} : { target: host }),
    class: TOOL_CLASS.READ,
    // A fetch only ever reads, so a rule about changing a host lets it through.
    arguments: {
      [HTTP_METHOD_ARGUMENT]: HTTP_METHOD.GET,
      ...(url === undefined ? {} : { url }),
    },
  };
}

/** A web search names no host, so only a rule over every request reaches it. */
function searchRequest(input: HookFields): ToolRequest {
  const query = firstText(input, ['query']);
  return {
    action: EGRESS_REQUEST_ACTION,
    class: TOOL_CLASS.READ,
    arguments: {
      [HTTP_METHOD_ARGUMENT]: HTTP_METHOD.GET,
      ...(query === undefined ? {} : { query }),
    },
  };
}

function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    return host === '' ? undefined : host;
  } catch {
    // Not a URL after all, so there is no host to name and none is guessed.
    return undefined;
  }
}
