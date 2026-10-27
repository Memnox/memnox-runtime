import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import type {
  AgentNode,
  CardExcerpt,
  TraceCard,
  CardFile,
  DisplayKind,
  DisplayVia,
  WalkPage,
} from '../daemon/protocol';
import type { Delivery, DeliveryProof, Sight, Witness } from '../daemon/delivery';
import { DISPLAY } from '../daemon/protocol';
import type { ToolSignIn } from '../daemon/work-cards';
import type { CapabilityTally } from '../discovery/capabilities';
import { shortDigest } from '../domain/digest';
import { JsonRecordDir } from '../store/json-records';

/**
 * A request from the operator to show the person something: a session's window, or a card
 * with its summary. It changes nothing an agent can do, so it needs no confirmation, and it
 * expires quickly because a window that opens a minute after it was asked for is a surprise.
 */

export const DISPLAYS_DIR = 'displays';

/** Long enough for the app to pick it up, short enough that a late one is dropped. */
export const DISPLAY_TTL_MS = 30_000;

/** An instruction or a line of speech; a page of text is not one. */
export const DISPLAY_TEXT_LIMIT = 600;

/** A card lays out what happened in a session, read rather than heard, so it may run longer. */
const CARD_TEXT_LIMIT = 2_400;

/** As many files as a card can list and still be read at a glance. */
export const CARD_FILES = 6;
/** A handful of changed lines, enough to see what the change is. */
export const CARD_LINES = 12;
/** A walk through covers the files that matter, never every file a session touched. */
export const WALK_PAGES = 5;
/** As many agents as fit around the middle of a screen and can still each be read. */
export const SCAN_AGENTS = 12;
/** As many steps as a card shows before it is a log rather than a picture. */
export const TRACE_ROWS = 16;
/** An app is opened on a folder and handed a task, which no app needs more links than this for. */
const APP_LINKS = 3;

export interface DisplayRequest {
  id: string;
  display: DisplayKind;
  sessionId: string;
  agent: string;
  title: string;
  text?: string;
  /** The session's folder, for when where it runs on screen was never noted. */
  cwd?: string;
  /** The terminal an instruction is typed into, which only the request itself may name. */
  tty?: string;
  files?: CardFile[];
  excerpt?: CardExcerpt;
  pages?: WalkPage[];
  agents?: AgentNode[];
  /** On AGENTS, the machine's count of what can change something outside it. */
  capabilities?: CapabilityTally;
  trace?: TraceCard;
  /** On APP, the app opened first, its links opened in order after, and what it reads as it opens. */
  appPath?: string;
  links?: string[];
  env?: Record<string, string>;
  /** On LAUNCH, a terminal app or an editor's agent panel rather than a terminal tab. */
  via?: DisplayVia;
  /** On FOCUS, the terminal a tmux or WezTerm pane is seen in, which stands in for where it runs. */
  shownIn?: ShownIn;
  /** Lines only this session's tab shows, so the Mac can find it among a terminal app's tabs by what is in it. */
  marks?: string[];
  requestedAt: string;
  expiresAt: string;
  /** Set once the Mac says how typing it ended; a delivered request is never shown again. */
  delivered?: DisplayDelivery;
  /** On LOOK, what the Mac saw, which also marks it answered. */
  seen?: Sight;
  /** On SIGN_IN, the tools to show and the page each signs in on. */
  signIn?: ToolSignIn[];
}

/** What the Mac said became of an instruction it was asked to type. */
export interface DisplayDelivery {
  outcome: Delivery;
  at: string;
  /** In the Mac's words, when it could say why it could not. */
  reason?: string;
  /** What the Mac read back after acting, which only a verified delivery must carry. */
  proof?: DeliveryProof;
  /** The Mac already said out loud what the person has to do, so nothing more is said about it. */
  told?: boolean;
  /** The target's window either side of acting, and the words read off it after, as the Mac saw them. */
  evidence?: Witness;
  /** The paired device it happened on, by name, when a phone did it rather than the Mac. */
  on?: string;
}

export interface DisplayInput {
  display: DisplayKind;
  sessionId: string;
  agent: string;
  title: string;
  text?: string;
  cwd?: string;
  tty?: string;
  files?: CardFile[];
  excerpt?: CardExcerpt;
  pages?: WalkPage[];
  agents?: AgentNode[];
  capabilities?: CapabilityTally;
  trace?: TraceCard;
  appPath?: string;
  links?: string[];
  env?: Record<string, string>;
  via?: DisplayVia;
  shownIn?: ShownIn;
  marks?: string[];
  signIn?: ToolSignIn[];
  at: string;
}

/** The app and tab a person sees a session in, when that is not where its process runs. */
export interface ShownIn {
  app?: string;
  appPath?: string;
  tty?: string;
}

/** Enough lines to tell one session's tab from another's, few enough to read each tab quickly. */
const MOST_MARKS = 4;

/** The app a request opens or shows the session in, and how it reaches it. */
function whereItGoes(
  input: DisplayInput,
): Pick<DisplayRequest, 'appPath' | 'links' | 'env' | 'via' | 'shownIn' | 'marks'> {
  return {
    ...(input.appPath === undefined ? {} : { appPath: input.appPath }),
    ...(input.links === undefined ? {} : { links: input.links.slice(0, APP_LINKS) }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.via === undefined ? {} : { via: input.via }),
    ...(input.shownIn === undefined ? {} : { shownIn: input.shownIn }),
    ...(input.marks === undefined || input.marks.length === 0
      ? {}
      : { marks: input.marks.slice(0, MOST_MARKS) }),
  };
}

export class DisplayRequests {
  private readonly records: JsonRecordDir<DisplayRequest>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, DISPLAYS_DIR));
  }

  async request(input: DisplayInput): Promise<DisplayRequest> {
    const text = input.text?.slice(
      0,
      input.display === DISPLAY.CARD ? CARD_TEXT_LIMIT : DISPLAY_TEXT_LIMIT,
    );
    const request: DisplayRequest = {
      id: `dsp_${Date.parse(input.at).toString(36)}_${shortDigest(`${input.sessionId}${input.display}${input.title}`)}`,
      display: input.display,
      sessionId: input.sessionId,
      agent: input.agent,
      title: input.title,
      ...(text === undefined ? {} : { text }),
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      ...(input.tty === undefined ? {} : { tty: input.tty }),
      ...(input.files === undefined ? {} : { files: input.files.slice(0, CARD_FILES) }),
      ...(input.excerpt === undefined
        ? {}
        : {
            excerpt: {
              path: input.excerpt.path,
              lines: input.excerpt.lines.slice(0, CARD_LINES),
            },
          }),
      ...(input.pages === undefined ? {} : { pages: walkPages(input.pages) }),
      ...(input.agents === undefined
        ? {}
        : { agents: input.agents.slice(0, SCAN_AGENTS) }),
      ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
      ...(input.trace === undefined
        ? {}
        : { trace: { ...input.trace, rows: input.trace.rows.slice(0, TRACE_ROWS) } }),
      ...whereItGoes(input),
      ...(input.signIn === undefined ? {} : { signIn: input.signIn }),
      requestedAt: input.at,
      expiresAt: new Date(Date.parse(input.at) + DISPLAY_TTL_MS).toISOString(),
    };
    await this.records.write(request.id, request);
    return request;
  }

  /** Only what has not expired, oldest first, removing what has so the folder never grows. */
  async open(moment: string): Promise<DisplayRequest[]> {
    const found = await this.records.all();
    for (const each of found) {
      if (each.expiresAt <= moment) await this.records.remove(each.id);
    }
    return found
      .filter(
        (each) =>
          each.expiresAt > moment &&
          each.delivered === undefined &&
          each.seen === undefined,
      )
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  /** The Mac's word on a request, false when it is gone, since a late answer has nobody waiting on it. */
  async deliver(id: string, delivery: DisplayDelivery): Promise<boolean> {
    const request = await this.records.read(id);
    if (request === null) return false;
    await this.records.write(id, { ...request, delivered: delivery });
    return true;
  }

  /** One request by its id, or null once it is gone. */
  async read(id: string): Promise<DisplayRequest | null> {
    return this.records.read(id);
  }

  /** What the Mac saw for a LOOK, false when the request is gone. */
  async see(id: string, sight: Sight): Promise<boolean> {
    const request = await this.records.read(id);
    if (request === null) return false;
    await this.records.write(id, { ...request, seen: sight });
    return true;
  }

  async sightOf(id: string): Promise<Sight | null> {
    return (await this.records.read(id))?.seen ?? null;
  }

  async deliveryOf(id: string): Promise<DisplayDelivery | null> {
    return (await this.records.read(id))?.delivered ?? null;
  }
}

/** A walk through kept to what can be read along with the voice. */
function walkPages(pages: readonly WalkPage[]): WalkPage[] {
  return pages.slice(0, WALK_PAGES).map((page) => ({
    ...page,
    note: page.note.slice(0, DISPLAY_TEXT_LIMIT),
    lines: page.lines.slice(0, CARD_LINES),
  }));
}
