import { request } from 'node:http';
import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { listenOnLoopback } from '../src/mcp/callback-listener';
import { SIGN_IN_PAGE } from '../src/mcp/callback-page';

/**
 * The page a sign in comes back to, on a real loopback port: it holds the browser for the outcome,
 * and closing it never waits on a connection the browser left open, which is what once hung a run.
 */

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    request(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    })
      .on('error', reject)
      .end();
  });
}

describe('the loopback page a sign in comes back to', () => {
  it('hands over the answer and shows the browser the outcome it is told', async () => {
    const listener = await listenOnLoopback({ server: 'videos' });
    const shown = get(`${listener.redirectUri}?code=abc&state=s1`);

    expect(await listener.answer()).toEqual({ code: 'abc', state: 's1' });
    listener.reply({ kind: SIGN_IN_PAGE.CONNECTED, server: 'videos' });
    const page = await shown;
    await listener.close();

    expect(page.status).toBe(200);
    expect(page.body).toContain('videos is connected');
  });

  it('closes at once with a connection the browser opened and never used', async () => {
    const listener = await listenOnLoopback({ server: 'videos' });
    const { port } = new URL(listener.redirectUri);
    const idle = connect(Number(port), '127.0.0.1');
    await new Promise<void>((resolve) => idle.once('connect', () => resolve()));
    const started = Date.now();

    await listener.close();

    expect(Date.now() - started).toBeLessThan(1_000);
    idle.destroy();
  });

  it('answers nothing but its own path', async () => {
    const listener = await listenOnLoopback({ server: 'videos' });
    const { origin } = new URL(listener.redirectUri);

    expect((await get(`${origin}/favicon.ico`)).status).toBe(404);
    await listener.close();
  });
});
