import { TRACKER, type ExternalTaskRef, type Tracker } from './agent-work';

/**
 * A tracker's issue as a person names it: a key such as `LIN-123`, or the issue's own link.
 * Read off what was typed and never fetched, since the tracker stays the record of the work.
 */

const ISSUE_KEY = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,6})$/;
const LINEAR_PATH = /\/issue\/([A-Za-z][A-Za-z0-9]{1,9}-\d{1,6})/;
const JIRA_PATH = /\/browse\/([A-Za-z][A-Za-z0-9]{1,9}-\d{1,6})/;
const GITHUB_PATH = /^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/;
const ASANA_TASK = /\/(\d{6,})(?:\/f)?\/?$/;
const SOURCES: readonly string[] = Object.values(TRACKER);

/** The tracker a bare key belongs to when the person did not say; Linear's keys read the same as Jira's. */
const BARE_KEY_SOURCE = TRACKER.LINEAR;

export function isTracker(value: string): value is Tracker {
  return SOURCES.includes(value);
}

/** The issue a person named, or null when it reads as no tracker's issue. */
export function externalTaskOf(typed: string, source?: Tracker): ExternalTaskRef | null {
  const text = typed.trim();
  const key = ISSUE_KEY.exec(text);
  if (key !== null)
    return { source: source ?? BARE_KEY_SOURCE, externalId: text.toUpperCase() };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // Neither a key nor a link is not an issue anybody can find, which is the caller's to say.
    return null;
  }
  return fromUrl(url);
}

function fromUrl(url: URL): ExternalTaskRef | null {
  const link = url.toString();
  const host = url.hostname.toLowerCase();
  if (host === 'linear.app' || host.endsWith('.linear.app'))
    return keyed(TRACKER.LINEAR, LINEAR_PATH.exec(url.pathname), link);
  if (host.endsWith('.atlassian.net') || JIRA_PATH.test(url.pathname))
    return keyed(TRACKER.JIRA, JIRA_PATH.exec(url.pathname), link);
  if (host === 'github.com') {
    const issue = GITHUB_PATH.exec(url.pathname);
    if (issue === null) return null;
    const [, owner, repo, number] = issue;
    return {
      source: TRACKER.GITHUB,
      externalId: `${owner}/${repo}#${number}`,
      url: link,
    };
  }
  if (host === 'app.asana.com') {
    const task = ASANA_TASK.exec(url.pathname);
    return task === null || task[1] === undefined
      ? null
      : { source: TRACKER.ASANA, externalId: task[1], url: link };
  }
  return null;
}

function keyed(
  source: Tracker,
  match: RegExpExecArray | null,
  url: string,
): ExternalTaskRef | null {
  const key = match === null ? undefined : match[1];
  return key === undefined ? null : { source, externalId: key.toUpperCase(), url };
}

/** The ref a branch named after this issue declares, as `workRefsOfBranch` writes it. */
export function branchRefOf(target: ExternalTaskRef): string | null {
  return ISSUE_KEY.test(target.externalId) ? `ticket:${target.externalId}` : null;
}
