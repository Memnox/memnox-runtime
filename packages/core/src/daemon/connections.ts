/**
 * Connecting the person's own tools from any screen: every person on every plan may connect any
 * toolkit the cloud's catalogue holds, as themselves, with nobody else asked first.
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

/** One tool the catalogue offers, by the slug a sign in takes. */
export interface ToolkitSummary {
  slug: string;
  name: string;
  logo?: string;
}

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
}
