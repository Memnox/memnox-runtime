#!/usr/bin/env node
// A fleet in a terminal, for load testing a control plane before customers do it for you.
// Each simulated machine speaks exactly what an enrolled runtime speaks: it joins with a single
// use token, beats every minute, and sends signed batches of actions while its agents work.
//
//   node scripts/machine-sim.mjs enrol  --url <base> --workspace <ws> --admin-token <t> --machines 30000
//   node scripts/machine-sim.mjs run    --minutes 30 [--agents 3] [--actions-per-minute 2] [--held 0.01]
//   node scripts/machine-sim.mjs revoke --admin-token <t>
//
// Enrolled machines and their keys are kept in $TMPDIR/memnox-machine-sim.json, never in a repo.
// It refuses any host that is not localhost or named staging unless --allow-host names it, since
// thirty thousand machines pointed at production by a typo is an outage you caused.

import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STATE = join(process.env.TMPDIR ?? tmpdir(), 'memnox-machine-sim.json');
const HEARTBEAT_MS = 60_000;
// While its agents work a runtime sends what they did every ten seconds.
const ACTIVE_PASS_MS = 10_000;
// The control plane refuses more rows than this in one post.
const MAX_POST = 500;
const REPORT_MS = 10_000;

function args(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at];
    if (!word.startsWith('--')) continue;
    const next = rest[at + 1];
    const valued = next !== undefined && !next.startsWith('--');
    options[word.slice(2)] = valued ? next : 'true';
    if (valued) at += 1;
  }
  return { command, options };
}

function load() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return { machines: [] };
  }
}

function save(state) {
  writeFileSync(STATE, JSON.stringify(state), { mode: 0o600 });
}

function guard(url, allowed) {
  const host = new URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host.includes('staging');
  if (local || host === allowed) return;
  console.error(`refusing ${host}: not localhost or staging. Pass --allow-host ${host} if you mean it.`);
  process.exit(2);
}

/** Every request timed and counted by route, so the report is percentiles rather than an average. */
class Recorder {
  constructor() {
    this.routes = new Map();
  }
  note(route, ms, status) {
    const seen = this.routes.get(route) ?? { times: [], statuses: new Map() };
    seen.times.push(ms);
    seen.statuses.set(status, (seen.statuses.get(status) ?? 0) + 1);
    this.routes.set(route, seen);
  }
  report(sinceMs) {
    const seconds = Math.max(1, (Date.now() - sinceMs) / 1000);
    const lines = [];
    for (const [route, seen] of this.routes) {
      const times = [...seen.times].sort((a, b) => a - b);
      const at = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0;
      const statuses = [...seen.statuses].map(([code, n]) => `${code}:${n}`).join(' ');
      lines.push(
        `${route.padEnd(10)} ${String(times.length).padStart(8)} req  ${(times.length / seconds).toFixed(1).padStart(7)}/s  p50 ${at(0.5).toFixed(0)}ms  p95 ${at(0.95).toFixed(0)}ms  p99 ${at(0.99).toFixed(0)}ms  ${statuses}`,
      );
    }
    return lines;
  }
}

async function call(recorder, route, { url, method = 'POST', token, body, machine }) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const headers = { accept: 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (raw !== undefined) headers['content-type'] = 'application/json';
  if (machine !== undefined && raw !== undefined) {
    headers['x-memnox-machine'] = machine.machineId;
    headers['x-memnox-signature'] = sign(null, Buffer.from(raw), machine.privateKey).toString('base64');
  }
  const started = performance.now();
  try {
    const response = await fetch(url, { method, headers, body: raw });
    recorder.note(route, performance.now() - started, response.status);
    const text = await response.text();
    return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
  } catch (err) {
    recorder.note(route, performance.now() - started, 'error');
    return { status: 0, error: String(err) };
  }
}

/** At most `limit` in flight, so the simulator measures the server rather than its own queue. */
async function pool(items, limit, work) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await work(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function enrol(options) {
  const { url, workspace } = options;
  guard(url, options['allow-host']);
  const count = Number(options.machines ?? '100');
  const state = load();
  const recorder = new Recorder();
  const started = Date.now();
  await pool(Array.from({ length: count }), Number(options.concurrency ?? '50'), async (_, n) => {
    const minted = await call(recorder, 'mint', {
      url: `${url}/v1/workspaces/${workspace}/machines/join-tokens`,
      token: options['admin-token'],
      body: { label: `sim-${n}`, machineClass: 'server' },
    });
    if (minted.body?.token === undefined) return;
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const joined = await call(recorder, 'join', {
      url: `${url}/v1/machines/join`,
      body: {
        token: minted.body.token,
        hostname: `memnox-sim-${n}-${randomBytes(3).toString('hex')}`,
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
        runtimeVersion: 'sim',
        machineClass: 'server',
      },
    });
    if (joined.body?.machineId === undefined) return;
    state.machines.push({
      url,
      workspaceId: joined.body.workspaceId,
      machineId: joined.body.machineId,
      token: joined.body.token,
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    });
  });
  save(state);
  for (const line of recorder.report(started)) console.log(line);
  console.log(`${state.machines.length} machine(s) enrolled in ${STATE}`);
}

function actionRows(machine, agents, actionsPerMinute, held) {
  const rows = [];
  const now = Date.now();
  const count = Math.max(1, Math.round((agents * actionsPerMinute * ACTIVE_PASS_MS) / 60_000));
  for (let n = 0; n < count && rows.length < MAX_POST; n += 1) {
    const agent = `sim-agent-${n % agents}`;
    const session = `ses_${machine.machineId}_${n % agents}`;
    const id = `evt_${randomBytes(8).toString('hex')}`;
    if (!machine.sessions.has(session)) {
      machine.sessions.add(session);
      rows.push({
        kind: 'agent.session.started',
        dedupKey: `session:${session}`,
        subjectId: session,
        actorType: 'agent',
        occurredAt: now,
        agentSessionId: session,
        payload: { agentId: agent, agentKind: 'claude-code' },
      });
    }
    const asks = Math.random() < held;
    rows.push({
      kind: 'agent.action.recorded',
      dedupKey: id,
      subjectId: id,
      actorType: 'agent',
      occurredAt: now,
      agentSessionId: session,
      payload: {
        agentId: agent,
        surface: 'shell',
        operation: asks ? 'git.push' : 'npm.test',
        classes: [asks ? 'write' : 'read'],
        resourceRef: `h_${randomBytes(12).toString('hex')}`,
        effect: asks ? 'ask' : 'allow',
        finalEffect: asks ? 'ask' : 'allow',
        reason: 'simulated',
        exitCode: 0,
        errored: false,
      },
    });
  }
  return rows;
}

function heartbeat(machine, held) {
  const holding =
    Math.random() < held
      ? [
          {
            id: `apr_${randomBytes(6).toString('hex')}`,
            agent: 'sim-agent-0',
            operation: 'git.push',
            summary: 'sim-agent-0 wants to push main',
            why: 'Pushing to main needs a person.',
            reason: 'simulated',
            askedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          },
        ]
      : [];
  return { runtimeVersion: 'sim', mode: 'enforce', budgets: [], agents: [], holding };
}

async function run(options) {
  const state = load();
  if (state.machines.length === 0) {
    console.error('no machines enrolled; run "enrol" first');
    process.exit(2);
  }
  guard(state.machines[0].url, options['allow-host']);
  const minutes = Number(options.minutes ?? '10');
  const agents = Number(options.agents ?? '3');
  const actionsPerMinute = Number(options['actions-per-minute'] ?? '2');
  const held = Number(options.held ?? '0.01');
  const active = Number(options.active ?? '0.3');
  const recorder = new Recorder();
  const started = Date.now();
  const until = started + minutes * 60_000;
  const timers = [];

  for (const machine of state.machines) {
    machine.sessions = new Set();
    const base = `${machine.url}/v1/workspaces/${machine.workspaceId}`;
    const beat = () =>
      void call(recorder, 'heartbeat', {
        url: `${base}/machines/${machine.machineId}/heartbeat`,
        token: machine.token,
        body: heartbeat(machine, held),
        machine,
      });
    const send = () => {
      if (Math.random() >= active) return;
      void call(recorder, 'events', {
        url: `${base}/events`,
        token: machine.token,
        body: { events: actionRows(machine, agents, actionsPerMinute, held) },
        machine,
      });
    };
    // Spread across the interval, since a real fleet never beats in step.
    timers.push(setTimeout(() => timers.push(setInterval(beat, HEARTBEAT_MS)), Math.random() * HEARTBEAT_MS));
    timers.push(setTimeout(() => timers.push(setInterval(send, ACTIVE_PASS_MS)), Math.random() * ACTIVE_PASS_MS));
  }

  const reporter = setInterval(() => {
    console.log(`\n${Math.round((Date.now() - started) / 1000)}s, ${state.machines.length} machines`);
    for (const line of recorder.report(started)) console.log(line);
  }, REPORT_MS);

  await new Promise((resolve) => setTimeout(resolve, until - Date.now()));
  for (const timer of timers) clearInterval(timer);
  clearInterval(reporter);
  console.log('\nfinal');
  for (const line of recorder.report(started)) console.log(line);
}

async function revoke(options) {
  const state = load();
  const recorder = new Recorder();
  const started = Date.now();
  await pool(state.machines, Number(options.concurrency ?? '50'), async (machine) => {
    await call(recorder, 'revoke', {
      url: `${machine.url}/v1/workspaces/${machine.workspaceId}/machines/${machine.machineId}`,
      method: 'DELETE',
      token: options['admin-token'],
    });
  });
  save({ machines: [] });
  for (const line of recorder.report(started)) console.log(line);
}

const { command, options } = args(process.argv.slice(2));
if (command === 'enrol') await enrol(options);
else if (command === 'run') await run(options);
else if (command === 'revoke') await revoke(options);
else {
  console.error('usage: machine-sim.mjs enrol | run | revoke  (see the top of the file)');
  process.exit(2);
}
