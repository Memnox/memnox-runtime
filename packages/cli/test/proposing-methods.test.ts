import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  AGENTS_METHOD,
  BACKUP_METHOD,
  DAEMON_METHOD,
  HOME_METHOD,
  INDEX_METHOD,
  LAN_METHOD,
  MCP_HUB_METHOD,
  MEMORY_METHOD,
  PERSONAL_SYNC_METHOD,
  POLICY_METHOD,
  PROFILES_METHOD,
  PROJECTS_METHOD,
  PROPOSING_METHODS,
  SKILLS_METHOD,
} from '@memnox/core';

/**
 * PROPOSING_METHODS against the daemon's dispatch: every method answered in a file that can name a
 * proposal is either on the list or below as never proposing, so a new method is classified at once.
 */

const DAEMON_DIR = fileURLToPath(new URL('../src/daemon', import.meta.url));
const PROPOSAL_FIELDS = new Set([
  'proposed',
  'packProposed',
  'profileApplied',
  'indexInstalled',
]);
const METHODS: Readonly<Record<string, string>> = DAEMON_METHOD;
const GROUPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  AGENTS_METHOD,
  BACKUP_METHOD,
  HOME_METHOD,
  INDEX_METHOD,
  LAN_METHOD,
  MCP_HUB_METHOD,
  MEMORY_METHOD,
  PERSONAL_SYNC_METHOD,
  POLICY_METHOD,
  PROFILES_METHOD,
  PROJECTS_METHOD,
  SKILLS_METHOD,
};

/** Answered beside a proposing method and never naming a proposal itself. */
const NEVER_PROPOSES: readonly string[] = [
  // Reads, which a screen polls in the background.
  DAEMON_METHOD.HOME,
  DAEMON_METHOD.HUB,
  DAEMON_METHOD.SKILLS_HUB,
  DAEMON_METHOD.POLICY_RULES,
  DAEMON_METHOD.RULE_TEST,
  DAEMON_METHOD.RULES_EXPORT,
  DAEMON_METHOD.RULE_PACKS,
  DAEMON_METHOD.PROGRESS,
  DAEMON_METHOD.MEMORY_SOURCES,
  DAEMON_METHOD.MEMORY_SOURCE_READ,
  DAEMON_METHOD.MEMORY_LEARN,
  DAEMON_METHOD.MEMORY_SEARCH,
  DAEMON_METHOD.MEMORY_FACTS,
  DAEMON_METHOD.WORKSPACE_MEMORY,
  DAEMON_METHOD.WORKSPACE_GRAPH,
  DAEMON_METHOD.LAN_STATUS,
  DAEMON_METHOD.PERSONAL_SYNC_STATUS,
  DAEMON_METHOD.PERSONAL_SYNC_CONFLICTS,
  DAEMON_METHOD.PROFILES,
  DAEMON_METHOD.PROJECTS,
  DAEMON_METHOD.INDEX_LIST,
  DAEMON_METHOD.AGENTS,
  DAEMON_METHOD.AGENTS_SCAN,
  DAEMON_METHOD.MEMORY_LAYERS,
  DAEMON_METHOD.MEMORY_LAYERS_PLAN,
  DAEMON_METHOD.SESSION_COST,
  DAEMON_METHOD.SKILL_STATS,
  DAEMON_METHOD.SKILL_CALIBRATE,
  // Writes that only narrow, or keep a copy, so they are done at once with nothing to sign.
  DAEMON_METHOD.BACKUP_CREATE,
  DAEMON_METHOD.SERVER_REMOVE,
  DAEMON_METHOD.IMPORT,
  DAEMON_METHOD.SYNC,
  DAEMON_METHOD.TEST,
  DAEMON_METHOD.SECRET_SET,
  DAEMON_METHOD.SECRET_REMOVE,
  DAEMON_METHOD.SKILL_SYNC,
  DAEMON_METHOD.SKILL_DISABLE,
  DAEMON_METHOD.SKILL_ENABLE,
  DAEMON_METHOD.SKILL_REMOVE,
  // A note only adds to a backlog, and the layers are written in fences the person previewed.
  DAEMON_METHOD.SKILL_NOTE,
  DAEMON_METHOD.MEMORY_LAYERS_APPLY,
  DAEMON_METHOD.PROJECT_PUT,
  DAEMON_METHOD.MEMORY_SOURCE_ADD,
  DAEMON_METHOD.MEMORY_SOURCE_REMOVE,
  DAEMON_METHOD.MEMORY_REJECT,
  DAEMON_METHOD.MEMORY_EDIT,
  DAEMON_METHOD.MEMORY_FORGET,
  DAEMON_METHOD.PERSONAL_SYNC_NOW,
  DAEMON_METHOD.PERSONAL_SYNC_RESOLVE,
  DAEMON_METHOD.PROFILE_PUT,
  DAEMON_METHOD.PROFILE_REMOVE,
  // Which job an agent works under is a person's choice and grants nothing on its own.
  DAEMON_METHOD.PROFILE_BIND,
  DAEMON_METHOD.PROFILE_UNBIND,
  DAEMON_METHOD.TEMPLATES,
  DAEMON_METHOD.PROFILE_FROM_TEMPLATE,
  DAEMON_METHOD.AGENT_PAUSE,
  DAEMON_METHOD.SESSION_STOP,
  DAEMON_METHOD.AUTOPILOT_REVOKE,
  DAEMON_METHOD.MODE_ENFORCE,
];

/** The files the screens' and the voice's methods are answered in. */
function dispatchFiles(): string[] {
  return readdirSync(DAEMON_DIR)
    .filter((name) => name.endsWith('-answer.ts') || name === 'rule-calls.ts')
    .map((name) => join(DAEMON_DIR, name));
}

interface Dispatch {
  proposes: boolean;
  methods: ts.PropertyAccessExpression[];
}

/** A file answers every method of each group it names, defaults included, and each DAEMON_METHOD it names. */
function dispatchOf(file: string): Dispatch {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  const methods: ts.PropertyAccessExpression[] = [];
  let proposes = false;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) methods.push(node);
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      PROPOSAL_FIELDS.has(node.name.getText(source))
    )
      proposes = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { proposes, methods };
}

function methodsOf(node: ts.PropertyAccessExpression): string[] {
  if (!ts.isIdentifier(node.expression)) return [];
  const group = node.expression.text;
  if (!group.endsWith('_METHOD')) return [];
  if (group === 'DAEMON_METHOD') {
    const value = METHODS[node.name.text];
    if (value === undefined) throw new Error(`No daemon method ${node.name.text}`);
    return [value];
  }
  const values = GROUPS[group];
  if (values === undefined) throw new Error(`Add ${group} to GROUPS`);
  return Object.values(values);
}

describe('the methods whose answer can name a proposal', () => {
  const answered = new Set(
    dispatchFiles()
      .map(dispatchOf)
      .filter((each) => each.proposes)
      .flatMap((each) => each.methods.flatMap(methodsOf)),
  );

  it('are every method a proposing file answers, less the ones that never propose', () => {
    expect([...answered].sort()).toEqual(
      [...PROPOSING_METHODS, ...NEVER_PROPOSES].sort(),
    );
  });

  it('never call one of them never proposing, and name each once', () => {
    expect(PROPOSING_METHODS.filter((each) => NEVER_PROPOSES.includes(each))).toEqual([]);
    expect(new Set(PROPOSING_METHODS).size).toBe(PROPOSING_METHODS.length);
  });

  it('are all methods the daemon knows', () => {
    const known = new Set(Object.values(METHODS));
    expect(PROPOSING_METHODS.filter((each) => !known.has(each))).toEqual([]);
  });
});
