import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseConfig } from './config.ts';
import { SqliteStore } from './store.ts';
import { EventBus } from './bus.ts';
import { startSmtpServer } from './smtp.ts';
import type { SmtpHandle } from './smtp.ts';
import { startWebServer } from './web.ts';
import type { WebHandle } from './web.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = join(HERE, '..', '..', 'ui', 'dist', 'ui', 'browser');

function logCaptured(subject: string | null, from: string | null, to: string[], inbox: string): void {
  const time = new Date().toTimeString().slice(0, 8);
  console.log(`← ${time}  ${from ?? '?'} → ${to.join(', ')}  "${subject ?? '(no subject)'}"  [${inbox}]`);
}

export async function runMailtraxx(
  argv: string[],
): Promise<{ smtp: SmtpHandle; web: WebHandle; store: SqliteStore }> {
  const config = parseConfig(argv);
  const store = new SqliteStore(config.dbPath, config.retain);
  const bus = new EventBus();

  const smtp = await startSmtpServer(config, store, (result) => {
    bus.emit({ type: 'message.created', message: result.message });
    if (result.inboxCreated) bus.emit({ type: 'inbox.created', inbox: result.inbox });
    logCaptured(result.message.subject, result.message.fromDisplay, result.message.toAddrs, result.inbox.name);
  });

  const web = await startWebServer(config, store, bus, UI_ROOT);

  console.log(`mailtraxx  SMTP 127.0.0.1:${smtp.port}   UI http://localhost:${web.port}`);
  console.log(`           db ${config.dbPath}   keeping ${config.retain} messages per inbox`);

  if (config.open) {
    const { spawn } = await import('node:child_process');
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [`http://localhost:${web.port}`], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  }

  return { smtp, web, store };
}

// Only self-start when run as a program, not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    const running = await runMailtraxx(process.argv.slice(2));
    const shutdown = async () => {
      await running.smtp.close();
      await running.web.close();
      running.store.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  } catch (err) {
    console.error(`mailtraxx: ${(err as Error).message}`);
    process.exit(1);
  }
}
