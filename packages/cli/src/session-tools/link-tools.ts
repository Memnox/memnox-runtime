import { DISPLAY, DisplayRequests, wentIn, type DisplayDelivery } from '@memnox/core';
import { OPERATOR_AGENT } from './propose-tools';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';

/**
 * Putting what the voice found in front of the person: a page opened in their browser, or a list on a card.
 * Neither changes anything anywhere, so both happen at once, and only when the person asked for them.
 */

/** Not any one session's: the card and the page are about their tools, whatever they were looking at. */
const NO_SESSION = 'all';

/** Only the web: an address in any other scheme could start an app the person never meant to open. */
const WEB_SCHEMES: readonly string[] = ['https:', 'http:'];

/** Longer than any real page address, short enough that it is never a payload. */
const MOST_ADDRESS_CHARS = 2_048;

/** Long enough for the feed to hand the page over and a browser or a phone to say it opened. */
const LINK_WAIT_MS = 6_000;

/** The page at a web address, opened on the phone that asked while its app is open, else in their browser on the Mac. */
export async function openLinkTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const page = webAddress(textArg(args, 'url') ?? '');
  if (page === null) {
    return {
      opened: false,
      said: 'Pass url: the full https address of the page as a tool read it, such as a pull request html_url, a ticket url, a meeting link or a Slack permalink. Read it with run_tool or workspace_github first when you do not have it.',
    };
  }
  const request = await new DisplayRequests(deps.home).request({
    display: DISPLAY.LINK,
    sessionId: NO_SESSION,
    agent: OPERATOR_AGENT,
    title: page.host,
    links: [page.href],
    at: deps.now().toISOString(),
  });
  const delivery = (await deps.delivered?.(request.id, LINK_WAIT_MS)) ?? null;
  return { opened: page.href, ...openedAs(delivery) };
}

/** Where a search runs, so the person sees the results the way they would have searched themselves. */
const SEARCH_PAGE = 'https://www.google.com/search';
/** A sentence or two, never a pasted document. */
const MOST_QUERY_CHARS = 300;

/** Their words searched in their browser, as a results page opened the way open_link opens any page. */
export async function searchWebTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const query = (textArg(args, 'query') ?? '').trim().slice(0, MOST_QUERY_CHARS);
  if (query === '') {
    return {
      opened: false,
      said: 'Pass query: the words to search for, as they said them.',
    };
  }
  const page = new URL(SEARCH_PAGE);
  page.searchParams.set('q', query);
  return openLinkTool(deps, { url: page.href });
}

/** Where the page opened, from whoever opened it, so the voice never says the Mac when it was the phone. */
function openedAs(delivery: DisplayDelivery | null): Record<string, unknown> {
  if (delivery === null) {
    return {
      said: 'It was sent to open and nothing has said it opened yet. Say it should be opening, in a few words, naming the page.',
    };
  }
  if (!wentIn(delivery.outcome)) {
    return {
      opened: false,
      ...(delivery.reason === undefined ? {} : { why: delivery.reason }),
      said: 'It did not open: why says the reason. Say sorry in a few words and the reason in plain words.',
    };
  }
  if (delivery.on !== undefined) {
    return {
      on: delivery.on,
      said: `It opened on their ${delivery.on}, in the app that owns the link when it is installed, else the browser there. Say so in a few words, naming the page, such as "it is open on your phone".`,
    };
  }
  return {
    on: 'the Mac',
    said: 'It opened in their browser on the Mac. Say so in a few words, naming the page, such as "opening pull request 49".',
  };
}

/** A web address with no sign in folded into it, or null for anything else. */
function webAddress(text: string): URL | null {
  if (text.length > MOST_ADDRESS_CHARS) return null;
  try {
    const page = new URL(text);
    if (!WEB_SCHEMES.includes(page.protocol)) return null;
    // A name and password in the address would sign the browser in as whoever wrote it.
    if (page.username !== '' || page.password !== '') return null;
    return page;
  } catch {
    // Not an address at all, which is the same answer: there is nothing to open.
    return null;
  }
}

/** A list the voice read, put on a card on their screen, since ten names heard aloud are ten names forgotten. */
export async function showListTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const title = textArg(args, 'title') ?? '';
  const text = textArg(args, 'text') ?? '';
  if (title === '' || text === '') {
    return {
      shown: false,
      said: 'Pass title, such as "Open pull requests in acme/shop", and text: the list as markdown, one bullet per item.',
    };
  }
  await new DisplayRequests(deps.home).request({
    display: DISPLAY.CARD,
    sessionId: NO_SESSION,
    agent: OPERATOR_AGENT,
    title,
    text,
    at: deps.now().toISOString(),
  });
  return {
    shown: true,
    said: 'The list is on a card on their screen. Say so in a few words and give the gist, such as how many there are, rather than reading it out.',
  };
}
