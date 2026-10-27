import { isAbsolute, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from '../domain/digest';
import {
  CHANGE_DIRECTION,
  CHANGE_SUBJECT,
  type ChangeSubject,
} from './discovery.constants';
import type { EnvironmentChange } from './snapshot-changes';

/**
 * A comparison between two scans as SARIF 2.1.0, the format code scanning already reads,
 * so a pipeline that gates on `--fail-on` can show why next to the diff that caused it.
 * Only widenings are results: a removed permission is good news, never an alert.
 */

export const SARIF_VERSION = '2.1.0';
const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
const TOOL_NAME = 'memnox';
const INFORMATION_URI = 'https://memnox.dev';

/** What a pipeline does with a result: `error` fails the gate it was asked for. */
export const SARIF_LEVEL = {
  ERROR: 'error',
  WARNING: 'warning',
} as const;

export type SarifLevel = (typeof SARIF_LEVEL)[keyof typeof SARIF_LEVEL];

/** The fingerprint key, versioned so a later change to what it hashes is not a dedupe miss. */
const FINGERPRINT_KEY = 'memnoxChange/v1';

const RULE_TEXT: Readonly<Record<ChangeSubject, { name: string; text: string }>> = {
  [CHANGE_SUBJECT.AGENT]: {
    name: 'NewAgent',
    text: 'An agent appeared that the earlier scan did not see.',
  },
  [CHANGE_SUBJECT.SERVER]: {
    name: 'NewMcpServer',
    text: 'An MCP server was added, and every agent that launches it reaches its tools.',
  },
  [CHANGE_SUBJECT.TOOL]: {
    name: 'NewMcpTool',
    text: 'An MCP server gained tools, some of which may change something outside this machine.',
  },
  [CHANGE_SUBJECT.SURFACE]: {
    name: 'NewSurface',
    text: 'An agent gained a kind of surface it did not have, such as a shell.',
  },
  [CHANGE_SUBJECT.RESOURCE]: {
    name: 'WiderReach',
    text: 'A file or store became reachable by more agents than before.',
  },
  [CHANGE_SUBJECT.HARNESS]: {
    name: 'HarnessWidened',
    text: 'Something that runs other agents gained a role, a hook or a link to another machine.',
  },
  [CHANGE_SUBJECT.HOOK]: {
    name: 'NewHook',
    text: 'An agent now runs a command on its own events, which its permission prompt never sees.',
  },
};

export interface SarifInput {
  changes: readonly EnvironmentChange[];
  /** The ones the requested gate failed on, which become errors rather than warnings. */
  failing: readonly EnvironmentChange[];
  toolVersion: string;
  /** Where the pipeline runs, so a file inside it is named relative to the checkout. */
  root?: string;
}

export interface SarifLog {
  $schema: string;
  version: typeof SARIF_VERSION;
  runs: SarifRun[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
}

export interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations?: { physicalLocation: { artifactLocation: { uri: string } } }[];
  partialFingerprints: Record<string, string>;
}

/** One run, one rule per kind of change, and one result per widening. */
export function sarifOf(input: SarifInput): SarifLog {
  const failing = new Set(input.failing.map(fingerprintOf));
  const widening = input.changes.filter(
    (change) => change.direction === CHANGE_DIRECTION.WIDENS,
  );
  const subjects = [...new Set(widening.map((change) => change.subject))];
  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: input.toolVersion,
            informationUri: INFORMATION_URI,
            rules: subjects.map(ruleOf),
          },
        },
        results: widening.map((change) => {
          const fingerprint = fingerprintOf(change);
          const location = locationOf(change, input.root);
          return {
            ruleId: ruleIdOf(change.subject),
            level: failing.has(fingerprint) ? SARIF_LEVEL.ERROR : SARIF_LEVEL.WARNING,
            message: { text: messageOf(change) },
            ...(location === null
              ? {}
              : {
                  locations: [
                    { physicalLocation: { artifactLocation: { uri: location } } },
                  ],
                }),
            partialFingerprints: { [FINGERPRINT_KEY]: fingerprint },
          };
        }),
      },
    ],
  };
}

function ruleIdOf(subject: ChangeSubject): string {
  return `${TOOL_NAME}/widened-${subject}`;
}

function ruleOf(subject: ChangeSubject): SarifRule {
  const { name, text } = RULE_TEXT[subject];
  return { id: ruleIdOf(subject), name, shortDescription: { text } };
}

/** The sentence `scan --since` prints, with the update that explains it where one does. */
function messageOf(change: EnvironmentChange): string {
  const agents =
    change.agents === undefined || change.agents.length === 0
      ? ''
      : ` Reached by ${change.agents.join(', ')}.`;
  const cause =
    change.cause === undefined ? '' : ` Arrived when the agent ${change.cause}.`;
  return `${change.name} (${change.subject}): ${change.detail}.${agents}${cause}`;
}

/** The file that granted it, or the path that moved, as a URI code scanning can open. */
function locationOf(change: EnvironmentChange, root: string | undefined): string | null {
  const path = change.grantedBy ?? (isAbsolute(change.name) ? change.name : null);
  if (path === null || !isAbsolute(path)) return path;
  if (root !== undefined) {
    const inside = relative(root, path);
    if (inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)) {
      return inside.split(sep).join('/');
    }
  }
  return pathToFileURL(path).href;
}

/** Stable across runs while the change is the same, so a re-run is not a new alert. */
function fingerprintOf(change: EnvironmentChange): string {
  return digest(
    [change.subject, change.name, change.direction, change.detail].join('\u0000'),
  );
}
