import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import nodemailer from 'nodemailer';
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

/**
 * Splits an SSE byte stream into complete frames (`event: ...\ndata: ...\n\n`),
 * buffering any trailing partial frame for the next chunk.
 */
function frameSplitter() {
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    push(chunk: Uint8Array): string[] {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      return parts;
    },
  };
}

test(
  'a captured message reaches the browser over SSE and is readable via the API — the onSaved → bus.emit → SSE path',
  { timeout: 10_000 },
  async () => {
    const running = await runMailtraxx(['--smtp-port', '0', '--http-port', '0', '--db', ':memory:']);
    const base = `http://127.0.0.1:${running.web.port}`;
    const controller = new AbortController();

    try {
      const res = await fetch(`${base}/api/events`, { signal: controller.signal });
      assert.equal(res.status, 200);
      const reader = res.body!.getReader();
      const splitter = frameSplitter();

      // Read the ": connected" preamble before sending anything, so the bus
      // subscription is provably attached before the emit this test cares about.
      let frames: string[] = [];
      while (frames.length === 0) {
        const { value, done } = await reader.read();
        assert.equal(done, false, 'SSE stream ended before the preamble arrived');
        frames = splitter.push(value);
      }
      assert.ok(frames[0]?.startsWith(': connected'), `expected the SSE preamble, got: ${frames[0]}`);

      const transport = nodemailer.createTransport({
        host: '127.0.0.1',
        port: running.smtp.port,
        secure: false,
        auth: { user: 'integration-test', pass: 'anything' },
      });
      await transport.sendMail({
        from: 'no_reply@itest.dev',
        to: 'someone@example.com',
        subject: 'Integration test',
        html: '<p>hi</p>',
        text: 'hi',
      });
      transport.close();

      // inbox.created and message.created land back-to-back (order between
      // them isn't this test's concern — main.test.ts's own fix keeps
      // inbox.created first); scan whatever arrives for message.created.
      let created: { id: number; subject: string | null } | undefined;
      for (let attempts = 0; attempts < 20 && !created; attempts++) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const frame of splitter.push(value)) {
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.slice('data: '.length)) as { type: string; message?: { id: number; subject: string | null } };
          if (event.type === 'message.created' && event.message) created = event.message;
        }
      }
      assert.ok(created, 'expected a message.created SSE frame');
      assert.equal(created!.subject, 'Integration test');

      const full = await (await fetch(`${base}/api/messages/${created!.id}`)).json();
      assert.equal(full.subject, 'Integration test');
      assert.equal(full.html, '<p>hi</p>');
      assert.equal(full.text, 'hi');
    } finally {
      controller.abort();
      await running.smtp.close();
      await running.web.close();
      running.store.close();
    }
  },
);
