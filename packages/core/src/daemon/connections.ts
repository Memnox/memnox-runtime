/**
 * Connecting the person's own tools from any screen: every person signed in to Memnox Cloud, on
 * every plan, may connect any toolkit the cloud's catalogue holds, as themselves, with nobody else
 * asked first. Signed out, the catalogue can still be browsed but nothing is connected.
 */

/** A search answers no more than this many, which is what a picker shows before the person types more. */
export const MOST_TOOLKITS_FOUND = 30;

/** The sign in page for one tool, and whether the daemon already opened it in the Mac's browser. */
export interface ConnectionSignIn {
  /** The cloud's lowercase toolkit slug. */
  toolkit: string;
  url: string;
  /** False from a paired phone, which opens the page itself. */
  opened: boolean;
}

/** Memnox Cloud's own reading of a toolkit: whether it supplies records, conversation, or neither. */
export const TOOLKIT_KIND = {
  RECORD: 'record',
  CONVERSATION: 'conversation',
  OTHER: 'other',
} as const;

export type ToolkitKind = (typeof TOOLKIT_KIND)[keyof typeof TOOLKIT_KIND];

/** How fully Memnox Cloud reads a toolkit once connected: its history and its authors, or less. */
export const TOOLKIT_SUPPORT = {
  FULL: 'full',
  PARTIAL: 'partial',
} as const;

export type ToolkitSupport = (typeof TOOLKIT_SUPPORT)[keyof typeof TOOLKIT_SUPPORT];

/** Where a connector comes from, in the order a search offers them: the vendor's own first, a community server last. */
export const CONNECTOR_SOURCE = {
  /** The vendor's own server, or one the catalogue verified. */
  OFFICIAL: 'official',
  /** A command line tool on this machine. */
  CLI: 'cli',
  /** The vendor's API, reached through the catalogue. */
  API: 'api',
  /** A community MCP server. */
  MCP: 'mcp',
} as const;

export type ConnectorSource = (typeof CONNECTOR_SOURCE)[keyof typeof CONNECTOR_SOURCE];

/** The weight each source sorts by, highest first, which a screen shows as a chip. */
export const CONNECTOR_WEIGHT: Readonly<Record<ConnectorSource, number>> = {
  official: 4,
  cli: 3,
  api: 2,
  mcp: 1,
};

/** One tool the catalogue offers, by the slug a sign in takes; an older cloud sends only the first three. */
export interface ToolkitSummary {
  slug: string;
  name: string;
  logo?: string;
  /** The provider's own words for it, as the cloud's catalogue carries them. */
  description?: string;
  /** The provider's category tags, as written, which a screen counts into a rail. */
  categories?: string[];
  kind?: ToolkitKind;
  support?: ToolkitSupport;
  /** Where it comes from; a search answers official first, then cli, api and mcp. */
  source?: ConnectorSource;
  /** CONNECTOR_WEIGHT of its source. */
  weight?: number;
}

const SOURCES: readonly string[] = Object.values(CONNECTOR_SOURCE);

/** The source a catalogue entry names, or official where it says the catalogue verified it, else its API. */
export function connectorSourceOf(named: unknown, verified: unknown): ConnectorSource {
  // Cast is safe: checked against the four sources just before.
  if (typeof named === 'string' && SOURCES.includes(named))
    return named as ConnectorSource;
  return verified === true ? CONNECTOR_SOURCE.OFFICIAL : CONNECTOR_SOURCE.API;
}

/** Highest weight first, the catalogue's own order kept within a weight. */
export function rankedBySource(toolkits: readonly ToolkitSummary[]): ToolkitSummary[] {
  return toolkits
    .map((toolkit, index) => ({ toolkit, index }))
    .sort(
      (a, b) => (b.toolkit.weight ?? 0) - (a.toolkit.weight ?? 0) || a.index - b.index,
    )
    .map((each) => each.toolkit);
}

/** Why a connection cannot be made yet, as a state a screen draws rather than words it reads. */
export const CONNECT_STATE = {
  /** Nobody is signed in to Memnox Cloud on this machine, which connecting any app now needs. */
  SIGN_IN_NEEDED: 'sign-in-needed',
} as const;

export type ConnectState = (typeof CONNECT_STATE)[keyof typeof CONNECT_STATE];

export interface ConnectionsRequestFields {
  /** On CONNECTIONS_SIGN_IN and CONNECTIONS_SIGN_OUT: the tool, by its lowercase slug. */
  toolkit?: string;
  /** On CONNECTIONS_SIGN_IN: open a new sign in even where one already works, to use another account. */
  again?: boolean;
  /** On TOOLKITS_SEARCH: the words to match; left out lists the catalogue's first page. */
  query?: string;
}

export interface ConnectionsResponseFields {
  /** On CONNECTIONS_SIGN_IN: the page that connects the tool. */
  signIn?: ConnectionSignIn;
  /** On TOOLKITS_SEARCH: at most MOST_TOOLKITS_FOUND tools the catalogue matched. */
  toolkits?: ToolkitSummary[];
  /** On TOOLKITS_SEARCH and a refused CONNECTIONS_SIGN_IN: what connecting waits on, absent when nothing does. */
  connectState?: ConnectState;
}
