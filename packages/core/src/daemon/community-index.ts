/**
 * The community index as screens browse it: skills and rule packs from Memnox Cloud's marketplace
 * or a git repository's `index.json`. A download is checked against its digest before it is
 * written, and an install is only a skill held for acceptance or a pack's rules proposed.
 */

export const INDEX_METHOD = {
  /** The index, filtered by words and kind, read fresh or from what was last read. */
  INDEX_LIST: 'index-list',
  /** Fetches one version, checks its digest, and holds the skill or proposes the pack's rules. */
  INDEX_INSTALL: 'index-install',
} as const;

/** What a listing is, in the marketplace's own words. */
export const INDEX_KIND = {
  SKILL: 'skill',
  RULE_PACK: 'rule_pack',
} as const;

export type IndexKind = (typeof INDEX_KIND)[keyof typeof INDEX_KIND];

export interface IndexPublisherView {
  /** An organization or a member, as the marketplace says. */
  kind: string;
  name: string;
}

/** What a listing declares it needs, as its manifest in the index says; read before anything is installed. */
export interface IndexNeedsView {
  /** Paths it reads or writes. */
  filesystem: string[];
  /** Hosts it reaches. */
  network: string[];
  /** Commands it runs. */
  commands: string[];
  /** MCP servers it uses, by name. */
  mcpServers: string[];
  /** Tools it asks its agent for, by name. */
  tools: string[];
}

/** One listing as a screen browses it. */
export interface IndexEntryView {
  id: string;
  name: string;
  kind: IndexKind;
  description: string;
  category?: string;
  publisher: IndexPublisherView;
  license?: string;
  /** Agent kinds it supports; empty is every agent. */
  agents: string[];
  /** The newest version not marked unsafe, and the digest its content must match. */
  latest?: { version: string; digest: string };
  /** Versions marked unsafe since they were published, which nothing installs. */
  yanked: string[];
  /** Every published version is marked unsafe, so the listing offers nothing to install. */
  unsafe: boolean;
  /** The version of this skill the Skills Hub holds here, where it holds one. */
  installed?: string;
  /** What it declares it needs; absent where the index carries no manifest for it. */
  needs?: IndexNeedsView;
  /** What a person should know before installing it, each in a sentence; empty where nothing stands out. */
  warnings: string[];
}

export interface CommunityIndexView {
  /** Where the index was read from. */
  source: string;
  /** When it was read; absent before it was ever read. */
  fetchedAt?: string;
  /** False where the index held more than it carries. */
  complete: boolean;
  entries: IndexEntryView[];
  /** Why what is shown is not fresh, or why there is nothing, in a sentence. */
  said?: string;
}

/** What an install did, so a screen says it in a line and opens what waits on the person. */
export interface IndexInstalled {
  id: string;
  name: string;
  kind: IndexKind;
  version: string;
  digest: string;
  /** For a pack: one proposal per rule, each signed on its own. */
  proposed: string[];
  /** For a skill: it is in the Skills Hub, held until the person accepts it. */
  held: boolean;
  said: string;
}

export interface IndexRequestFields {
  /** On INDEX_LIST: words, each found in the name or the description. */
  indexQuery?: string;
  /** On INDEX_LIST: only skills, or only rule packs. */
  indexKind?: IndexKind;
  /** On INDEX_LIST: read again now rather than from what was last read. */
  indexRefresh?: boolean;
  /** On INDEX_LIST, from this machine only: the index to read from now on, an https URL to its `index.json`. */
  indexSource?: string;
  /** On INDEX_INSTALL: the listing, by id or by name. */
  indexName?: string;
  /** On INDEX_INSTALL: the version; absent is the newest not marked unsafe. */
  indexVersion?: string;
}

export interface IndexResponseFields {
  /** On INDEX_LIST, and after an install. */
  communityIndex?: CommunityIndexView;
  /** On INDEX_INSTALL. */
  indexInstalled?: IndexInstalled;
}
