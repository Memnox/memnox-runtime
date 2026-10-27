import { describe, expect, it } from 'vitest';
import {
  BROKER_VAR,
  brokerPathFor,
  credentialsFor,
  holdCredentials,
  parseBrokerRequest,
} from '../src/intercept/credential-broker';

const ENV = {
  PATH: '/usr/bin',
  HOME: '/home/dev',
  TERM: 'xterm',
  ANTHROPIC_API_KEY: 'sk-ant-1',
  GITHUB_TOKEN: 'ghp_1',
  AWS_ACCESS_KEY_ID: 'AKIA1',
  AWS_SECRET_ACCESS_KEY: 'secret',
  STRIPE_API_KEY: 'sk_live_1',
  DATABASE_URL: 'postgres://u:p@db/app',
};

describe('what an agent starts without', () => {
  it('holds every credential back except the agent’s own model key', () => {
    const { passed, held } = holdCredentials(ENV, 'claude');
    expect(Object.keys(held).sort()).toEqual([
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'DATABASE_URL',
      'GITHUB_TOKEN',
      'STRIPE_API_KEY',
    ]);
    expect(passed).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/dev',
      TERM: 'xterm',
      ANTHROPIC_API_KEY: 'sk-ant-1',
    });
  });

  it('keeps a different agent’s model key out of another agent’s reach', () => {
    const { held } = holdCredentials({ ...ENV, OPENAI_API_KEY: 'sk-1' }, 'claude');
    expect(held['OPENAI_API_KEY']).toBe('sk-1');
    expect(holdCredentials({ OPENAI_API_KEY: 'sk-1' }, 'codex').held).toEqual({});
  });
});

describe('what each binary is handed back', () => {
  const { held } = holdCredentials(ENV, 'claude');

  it('gives gh its token and nothing else', () => {
    expect(credentialsFor('gh', held)).toEqual({ GITHUB_TOKEN: 'ghp_1' });
  });

  it('gives aws the secret beside the id its table names', () => {
    expect(credentialsFor('aws', held)).toEqual({
      AWS_ACCESS_KEY_ID: 'AKIA1',
      AWS_SECRET_ACCESS_KEY: 'secret',
    });
  });

  it('gives psql the database URL its table names', () => {
    expect(credentialsFor('psql', held)).toEqual({
      DATABASE_URL: 'postgres://u:p@db/app',
    });
  });

  it('gives curl, and anything nobody mapped, nothing at all', () => {
    expect(credentialsFor('curl', held)).toEqual({});
    expect(credentialsFor('python3', held)).toEqual({});
  });
});

describe('a request to the broker', () => {
  it('names a binary by its basename and nothing else', () => {
    expect(parseBrokerRequest('{"binary":"gh"}')).toEqual({ binary: 'gh' });
    expect(parseBrokerRequest('{"binary":"/usr/bin/gh"}')).toBeNull();
    expect(parseBrokerRequest('{"binary":""}')).toBeNull();
    expect(parseBrokerRequest('not json')).toBeNull();
  });

  it('lives with the session’s other state, under its id', () => {
    expect(brokerPathFor('/home/dev', 'ses_1')).toBe(
      '/home/dev/.memnox/brokers/ses_1.sock',
    );
    expect(BROKER_VAR).toBe('MEMNOX_CREDENTIAL_BROKER');
  });
});
