import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runMailtraxx } from './main.ts';

/** Binds a throwaway listener to grab a free loopback port, then releases it. */
async function getFreePort(): Promise<number> {
  const srv = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve((srv.address() as AddressInfo).port));
  });
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

/** True if a listener can bind `port` on loopback — i.e. nothing else is holding it. */
async function portIsFree(port: number): Promise<boolean> {
  const probe = createServer();
  const free = await new Promise<boolean>((resolve) => {
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => resolve(true));
  });
  if (free) await new Promise<void>((resolve) => probe.close(() => resolve()));
  return free;
}

test('runMailtraxx closes its SMTP listener and store when the HTTP server fails to start', async () => {
  const smtpPort = await getFreePort();
  const blockedHttpPort = await getFreePort();

  // Occupy the HTTP port so runMailtraxx's own startWebServer call fails,
  // the same way a second mailtraxx instance racing for the same port would.
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(blockedHttpPort, '127.0.0.1', () => resolve());
  });

  try {
    await assert.rejects(
      runMailtraxx([
        '--smtp-port', String(smtpPort),
        '--http-port', String(blockedHttpPort),
        '--db', ':memory:',
      ]),
      /already in use/,
    );

    // If the SMTP listener (and its store) had leaked instead of being
    // closed on the HTTP failure, this port would still be held.
    assert.equal(await portIsFree(smtpPort), true, 'the SMTP port should have been released');
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});
