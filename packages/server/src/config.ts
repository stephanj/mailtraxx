import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  smtpPort: number;
  httpPort: number;
  dbPath: string;
  retain: number;
  maxSizeBytes: number;
  open: boolean;
}

function toPort(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`${flag} must be a number between 0 and 65535, got "${value}"`);
  }
  return n;
}

function toCount(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} must be a positive integer, got "${value}"`);
  }
  return n;
}

export function parseConfig(argv: string[]): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      'smtp-port': { type: 'string' },
      'http-port': { type: 'string' },
      db: { type: 'string' },
      retain: { type: 'string' },
      'max-size': { type: 'string' },
      open: { type: 'boolean', default: false },
    },
  });

  return {
    smtpPort: toPort(values['smtp-port'], '--smtp-port', 2525),
    httpPort: toPort(values['http-port'], '--http-port', 1080),
    dbPath: values.db ?? join(homedir(), '.mailtraxx', 'mailtraxx.db'),
    retain: toCount(values.retain, '--retain', 500),
    maxSizeBytes: toCount(values['max-size'], '--max-size', 25) * 1024 * 1024,
    open: values.open === true,
  };
}
