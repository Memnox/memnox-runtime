import { describe, expect, it } from 'vitest';
import { CHANGE_DIRECTION, CHANGE_SUBJECT } from '../src/discovery/discovery.constants';
import { SARIF_LEVEL, SARIF_VERSION, sarifOf } from '../src/discovery/sarif';
import type { EnvironmentChange } from '../src/discovery/snapshot-changes';

const ROOT = '/srv/app';

const hook: EnvironmentChange = {
  subject: CHANGE_SUBJECT.HOOK,
  name: 'node session-start.js',
  direction: CHANGE_DIRECTION.WIDENS,
  detail: 'runs on claude-code SessionStart · writes into what the model reads',
  grantedBy: `${ROOT}/.claude/settings.json`,
};

const server: EnvironmentChange = {
  subject: CHANGE_SUBJECT.SERVER,
  name: 'stripe',
  direction: CHANGE_DIRECTION.WIDENS,
  detail: '12 tools · 4 write',
  grantedBy: '/home/dev/.claude.json',
  agents: ['agt_claude-code'],
  cause: 'updated 1.0 → 1.1',
};

const removed: EnvironmentChange = {
  subject: CHANGE_SUBJECT.SERVER,
  name: 'old',
  direction: CHANGE_DIRECTION.NARROWS,
  detail: 'removed',
};

describe('a comparison as SARIF', () => {
  const log = sarifOf({
    changes: [hook, server, removed],
    failing: [server],
    toolVersion: '0.13.14',
    root: ROOT,
  });
  const run = log.runs[0];

  it('is one run of the version code scanning reads, named after the tool', () => {
    expect(log.version).toBe(SARIF_VERSION);
    expect(log.runs).toHaveLength(1);
    expect(run?.tool.driver).toEqual(
      expect.objectContaining({ name: 'memnox', version: '0.13.14' }),
    );
  });

  it('reports widenings only, since a removed permission is never an alert', () => {
    expect(run?.results.map((result) => result.ruleId)).toEqual([
      'memnox/widened-hook',
      'memnox/widened-server',
    ]);
    expect(run?.tool.driver.rules.map((rule) => rule.id)).toEqual([
      'memnox/widened-hook',
      'memnox/widened-server',
    ]);
  });

  it('makes an error of what the gate failed on and a warning of the rest', () => {
    expect(run?.results.map((result) => result.level)).toEqual([
      SARIF_LEVEL.WARNING,
      SARIF_LEVEL.ERROR,
    ]);
  });

  it('names a file in the checkout relative to it, and one outside it by URI', () => {
    const uris = run?.results.map(
      (result) => result.locations?.[0]?.physicalLocation.artifactLocation.uri,
    );
    expect(uris).toEqual(['.claude/settings.json', 'file:///home/dev/.claude.json']);
  });

  it('says who reaches it and what caused it, in the sentence a person reads', () => {
    expect(run?.results[1]?.message.text).toBe(
      'stripe (server): 12 tools · 4 write. Reached by agt_claude-code. Arrived when the agent updated 1.0 → 1.1.',
    );
  });

  it('fingerprints a change the same way on every run, so a re-run is not a new alert', () => {
    const again = sarifOf({ changes: [hook], failing: [], toolVersion: '9.9.9' });
    expect(again.runs[0]?.results[0]?.partialFingerprints).toEqual(
      run?.results[0]?.partialFingerprints,
    );
  });

  it('leaves out a location it cannot name rather than inventing one', () => {
    const agent: EnvironmentChange = {
      subject: CHANGE_SUBJECT.AGENT,
      name: 'codex-cli',
      direction: CHANGE_DIRECTION.WIDENS,
      detail: '2 surfaces',
    };
    const results = sarifOf({ changes: [agent], failing: [], toolVersion: '1' }).runs[0]
      ?.results;
    expect(results?.[0]?.locations).toBeUndefined();
  });
});
