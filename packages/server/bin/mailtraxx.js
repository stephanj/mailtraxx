#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const main = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main.ts');
const child = spawn(
  process.execPath,
  ['--no-warnings=ExperimentalWarning', main, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
