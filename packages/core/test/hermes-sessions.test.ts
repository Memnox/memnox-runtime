import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { readHermesMessages, readHermesSessions } from '../src/discovery/hermes-sessions';

/** A home with a Hermes database holding the columns this reads, as Hermes lays them out. */
async function hermesHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-hermes-'));
  await mkdir(join(home, '.hermes'));
  const db = new Database(join(home, '.hermes', 'state.db'));
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, display_name TEXT,
      started_at REAL NOT NULL, ended_at REAL, cwd TEXT, git_repo_root TEXT, tool_call_count INTEGER);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT, tool_name TEXT, timestamp REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1);
  `);
  const day = Date.parse('2026-10-06T00:00:00.000Z') / 1_000;
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    's_new',
    'cli',
    'Fix the invoice export',
    day + 3_600,
    null,
    '/srv/billing',
    '/srv/billing',
    4,
  );
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    's_old',
    'cli',
    null,
    day - 10 * 86_400,
    day - 10 * 86_400,
    '/srv/old',
    null,
    0,
  );
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    's_voice',
    'acp',
    null,
    day + 3_000,
    null,
    '/home/me/.memnox',
    null,
    0,
  );
  const say = db.prepare(
    'INSERT INTO messages (session_id, role, content, tool_name, timestamp, active) VALUES (?, ?, ?, ?, ?, ?)',
  );
  say.run('s_new', 'user', 'export the March invoices', null, day + 3_600, 1);
  say.run('s_new', 'tool', '{"rows": 120}', 'terminal', day + 3_610, 1);
  say.run('s_new', 'assistant', 'Exported 120 invoices.', null, day + 3_620, 1);
  say.run('s_new', 'assistant', 'an older draft', null, day + 3_615, 0);
  db.close();
  return home;
}

describe("Hermes's own sessions, read on a machine where it runs", () => {
  it('lists the sessions active lately with where they work, newest first', async () => {
    const home = await hermesHome();
    const sessions = readHermesSessions(home, new Date('2026-10-05T00:00:00.000Z'));

    expect(sessions).toEqual([
      {
        id: 's_new',
        title: 'Fix the invoice export',
        startedAt: '2026-10-06T01:00:00.000Z',
        lastActive: '2026-10-06T01:00:20.000Z',
        directory: '/srv/billing',
        toolCalls: 4,
        source: 'cli',
      },
      {
        id: 's_voice',
        startedAt: '2026-10-06T00:50:00.000Z',
        lastActive: '2026-10-06T00:50:00.000Z',
        directory: '/home/me/.memnox',
        toolCalls: 0,
        source: 'acp',
      },
    ]);
  });

  it('leaves out the sources it is asked to skip', async () => {
    const home = await hermesHome();
    const sessions = readHermesSessions(home, new Date('2026-10-05T00:00:00.000Z'), [
      'acp',
    ]);

    expect(sessions.map((each) => each.id)).toEqual(['s_new']);
  });

  it('still reads a Hermes that keeps no source, and skips nothing there', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-hermes-'));
    await mkdir(join(home, '.hermes'));
    const db = new Database(join(home, '.hermes', 'state.db'));
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, display_name TEXT, started_at REAL NOT NULL,
        ended_at REAL, cwd TEXT, git_repo_root TEXT, tool_call_count INTEGER);
      CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        role TEXT NOT NULL, content TEXT, tool_name TEXT, timestamp REAL NOT NULL,
        active INTEGER NOT NULL DEFAULT 1);
    `);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      's_old_schema',
      null,
      Date.parse('2026-10-06T00:00:00.000Z') / 1_000,
      null,
      null,
      null,
      1,
    );
    db.close();

    const sessions = readHermesSessions(home, new Date('2026-10-05T00:00:00.000Z'), [
      'acp',
    ]);

    expect(sessions).toEqual([
      {
        id: 's_old_schema',
        startedAt: '2026-10-06T00:00:00.000Z',
        lastActive: '2026-10-06T00:00:00.000Z',
        toolCalls: 1,
      },
    ]);
  });

  it('reads what was said, a tool by its name only, and skips what Hermes set aside', async () => {
    const home = await hermesHome();

    expect(readHermesMessages(home, 's_new')).toEqual([
      {
        at: '2026-10-06T01:00:00.000Z',
        role: 'person',
        text: 'export the March invoices',
      },
      { at: '2026-10-06T01:00:10.000Z', role: 'tool', text: 'terminal' },
      { at: '2026-10-06T01:00:20.000Z', role: 'agent', text: 'Exported 120 invoices.' },
    ]);
  });

  it('is empty where Hermes keeps no database', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-hermes-'));

    expect(readHermesSessions(home, new Date(0))).toEqual([]);
    expect(readHermesMessages(home, 's_new')).toEqual([]);
  });
});
