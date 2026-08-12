import { SMTPServer } from 'smtp-server';
import type { AddressInfo } from 'node:net';
import type { Config } from './config.ts';
import type { SqliteStore } from './store.ts';
import type { SaveResult } from './types.ts';
import { parseMessage } from './parse.ts';

export interface SmtpHandle {
  port: number;
  close(): Promise<void>;
}

export async function startSmtpServer(
  config: Config,
  store: SqliteStore,
  onSaved?: (result: SaveResult) => void,
): Promise<SmtpHandle> {
  const server = new SMTPServer({
    name: 'mailtraxx',
    banner: 'mailtraxx local capture server',
    authOptional: true,
    allowInsecureAuth: true,
    disabledCommands: ['STARTTLS'],
    size: config.maxSizeBytes,
    hideSTARTTLS: true,

    // Any credentials are accepted; the username selects the inbox. The
    // server binds to loopback only, so anything that can reach it can
    // already read the database file directly.
    onAuth(auth, _session, callback) {
      callback(null, { user: auth.username });
    },

    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', (err: Error) => callback(err));
      stream.on('end', () => {
        void (async () => {
          if (stream.sizeExceeded) {
            const err = new Error('Message exceeds the configured maximum size') as Error & { responseCode?: number };
            err.responseCode = 552;
            return callback(err);
          }

          const raw = Buffer.concat(chunks);
          const parsed = await parseMessage(raw, {
            smtpUser: typeof session.user === 'string' && session.user ? session.user : 'default',
            mailFrom: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
            rcptTo: session.envelope.rcptTo.map((r) => r.address),
            receivedAt: new Date().toISOString(),
          });

          let result: SaveResult;
          try {
            result = store.saveMessage(parsed);
          } catch (cause) {
            const err = new Error(`Could not store message: ${(cause as Error).message}`) as Error & {
              responseCode?: number;
            };
            err.responseCode = 451;
            return callback(err);
          }

          // The message is already durably stored at this point, so a
          // problem in the (optional, caller-supplied) onSaved callback must
          // not turn into a 451 — that would tell the sender to retry a
          // message that already made it in, producing a duplicate. Swallow
          // (rather than propagate) so it can't stop the 250 below or escape
          // as an unhandled rejection from this detached async callback.
          try {
            onSaved?.(result);
          } catch (cause) {
            console.error('mailtraxx: onSaved callback threw', cause);
          }
          callback(null, 'Message captured by mailtraxx');
        })();
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.smtpPort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    port: (server.server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
