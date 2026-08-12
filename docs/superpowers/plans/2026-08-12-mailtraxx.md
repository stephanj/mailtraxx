# mailtraxx Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Mailtrap replacement — one Node process that catches SMTP mail from local apps, stores it in SQLite, and serves an Angular 22 UI for reading it.

**Architecture:** A single npm package with two workspaces. `packages/server` runs an SMTP listener (`smtp-server` + `mailparser`) and an HTTP listener (`node:http`) over a shared SQLite store (`node:sqlite`), connected by an in-process event bus that pushes captured mail to browsers over SSE. `packages/ui` is an Angular 22 SPA served as static files by that same HTTP listener. Nothing leaves the machine; both listeners bind to `127.0.0.1`.

**Tech Stack:** Node 22 (native TypeScript type stripping, `node:sqlite`, `node:test`), `smtp-server` ^3.19, `mailparser` ^3.9, `nodemailer` ^7 (tests only), Angular 22 (standalone, zoneless, signals, `httpResource`).

**Spec:** `docs/superpowers/specs/2026-08-12-mailtraxx-design.md` — read it before starting.

## Global Constraints

- **Node 22+ required.** Verified on v22.22.3. The plan depends on three Node 22 features: native TypeScript type stripping (tests run `.ts` directly, no build step), `node:sqlite`, and `node:test`.
- **Angular 22 exactly** (`@angular/core` 22.1.1, CLI 22.1.3). Standalone components, zoneless change detection, signals, `httpResource()`, built-in control flow (`@if`/`@for`/`@switch`), `input()`/`output()`/`inject()`. No NgModules, no `*ngIf`, no constructor injection, no Zone.js.
- **Type-stripping compatible TypeScript only.** No `enum`, no `namespace`, no constructor parameter properties, no non-`type` re-exports of types. `tsconfig` sets `"erasableSyntaxOnly": true` so violations fail loudly. Angular's own code is compiled by the Angular CLI and is exempt.
- **ESM everywhere.** `"type": "module"`. Relative imports carry explicit extensions, and TypeScript sources import each other as `./foo.ts`.
- **Both listeners bind to `127.0.0.1`** — never `0.0.0.0`.
- **Defaults:** SMTP port 2525, HTTP port 1080, DB `~/.mailtraxx/mailtraxx.db`, retention 500 messages per inbox, max message size 25 MB.
- **`raw` is stored unconditionally**, including when MIME parsing fails.
- **Commit after every task.** Conventional commit messages (`feat:`, `test:`, `chore:`).

---

### Task 1: Workspace scaffold and CLI config

Sets up the repo layout and the config parsing every other unit consumes.

**Files:**
- Create: `package.json`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/config.ts`
- Create: `.gitignore`
- Test: `packages/server/src/config.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `Config` interface and `parseConfig(argv: string[]): Config` from `packages/server/src/config.ts`. Fields: `smtpPort: number`, `httpPort: number`, `dbPath: string`, `retain: number`, `maxSizeBytes: number`, `open: boolean`. Every later task takes `Config` as its first constructor/function argument.

- [ ] **Step 1: Create the root workspace manifest**

`package.json`:

```json
{
  "name": "mailtraxx-root",
  "private": true,
  "type": "module",
  "workspaces": ["packages/server", "packages/ui"],
  "scripts": {
    "test": "npm run test --workspace packages/server",
    "start": "node packages/server/src/main.ts"
  }
}
```

- [ ] **Step 2: Create the server package manifest**

`packages/server/package.json`:

```json
{
  "name": "mailtraxx",
  "version": "0.1.0",
  "type": "module",
  "bin": { "mailtraxx": "./bin/mailtraxx.js" },
  "scripts": {
    "test": "node --test 'src/**/*.test.ts'"
  },
  "dependencies": {
    "mailparser": "^3.9.15",
    "smtp-server": "^3.19.3"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "nodemailer": "^7.0.0",
    "typescript": "^5.7.0"
  },
  "engines": { "node": ">=22.18.0" }
}
```

- [ ] **Step 3: Create the TypeScript config**

`packages/server/tsconfig.json`. This is for editor/`tsc --noEmit` checking only — tests run the `.ts` files directly.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "bin/**/*.js"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.DS_Store
*.log
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: succeeds, creates `package-lock.json` and `node_modules/`.

- [ ] **Step 6: Write the failing test**

`packages/server/src/config.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from './config.ts';

test('defaults match the documented values', () => {
  const c = parseConfig([]);
  assert.equal(c.smtpPort, 2525);
  assert.equal(c.httpPort, 1080);
  assert.equal(c.dbPath, join(homedir(), '.mailtraxx', 'mailtraxx.db'));
  assert.equal(c.retain, 500);
  assert.equal(c.maxSizeBytes, 25 * 1024 * 1024);
  assert.equal(c.open, false);
});

test('flags override defaults', () => {
  const c = parseConfig([
    '--smtp-port', '3025',
    '--http-port', '8080',
    '--db', '/tmp/x.db',
    '--retain', '10',
    '--max-size', '5',
    '--open',
  ]);
  assert.equal(c.smtpPort, 3025);
  assert.equal(c.httpPort, 8080);
  assert.equal(c.dbPath, '/tmp/x.db');
  assert.equal(c.retain, 10);
  assert.equal(c.maxSizeBytes, 5 * 1024 * 1024);
  assert.equal(c.open, true);
});

test('rejects a non-numeric port', () => {
  assert.throws(() => parseConfig(['--smtp-port', 'abc']), /--smtp-port must be a number/);
});

test('rejects a port outside the valid range', () => {
  assert.throws(() => parseConfig(['--http-port', '70000']), /--http-port must be a number/);
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test --workspace packages/server`
Expected: FAIL — cannot find module `./config.ts`.

- [ ] **Step 8: Write the implementation**

`packages/server/src/config.ts`:

```ts
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
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test --workspace packages/server`
Expected: PASS — 4 tests.

- [ ] **Step 10: Commit**

```bash
git add package.json packages/server .gitignore package-lock.json
git commit -m "feat: scaffold workspace and CLI config parsing"
```

---

### Task 2: Store — schema and inboxes

The SQLite layer, starting with inbox creation and routing. Inboxes are keyed on the immutable SMTP username; `name` is a mutable display label.

**Files:**
- Create: `packages/server/src/types.ts`
- Create: `packages/server/src/store.ts`
- Test: `packages/server/src/store.inboxes.test.ts`

**Interfaces:**
- Consumes: `Config` from Task 1.
- Produces:
  - `packages/server/src/types.ts` — `Inbox`, `AttachmentMeta`, `MessageSummary`, `Message`, `ParsedMessage`, `SaveResult` (full definitions in Step 1 below). Every later task imports these.
  - `packages/server/src/store.ts` — `class SqliteStore` with `constructor(dbPath: string, retain: number)`, plus `listInboxes(): Inbox[]`, `getInbox(id: number): Inbox | undefined`, `ensureInbox(smtpUser: string): { inbox: Inbox; created: boolean }`, `renameInbox(id: number, name: string): Inbox | undefined`, `close(): void`. Message methods are added in Task 3.

- [ ] **Step 1: Write the shared types**

`packages/server/src/types.ts`. These are the contract between every unit — later tasks reference these exact field names.

```ts
export interface Inbox {
  id: number;
  smtpUser: string;
  name: string;
  createdAt: string;
  messageCount: number;
  latestReceivedAt: string | null;
}

export interface AttachmentMeta {
  filename: string | null;
  contentType: string | null;
  sizeBytes: number;
}

export interface MessageSummary {
  id: number;
  inboxId: number;
  fromDisplay: string | null;
  toAddrs: string[];
  subject: string | null;
  sizeBytes: number;
  hasHtml: boolean;
  parseError: string | null;
  receivedAt: string;
}

export interface Message extends MessageSummary {
  messageId: string | null;
  fromAddr: string;
  ccAddrs: string[];
  html: string | null;
  text: string | null;
  raw: string;
  headers: Record<string, string>;
  attachments: AttachmentMeta[];
}

/** What the SMTP layer hands the store. No id yet — the store assigns it. */
export interface ParsedMessage {
  smtpUser: string;
  messageId: string | null;
  fromAddr: string;
  fromDisplay: string | null;
  toAddrs: string[];
  ccAddrs: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  raw: string;
  headers: Record<string, string>;
  sizeBytes: number;
  parseError: string | null;
  attachments: AttachmentMeta[];
  receivedAt: string;
}

export interface SaveResult {
  message: MessageSummary;
  inbox: Inbox;
  inboxCreated: boolean;
}
```

- [ ] **Step 2: Write the failing test**

`packages/server/src/store.inboxes.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from './store.ts';

function newStore() {
  return new SqliteStore(':memory:', 500);
}

test('ensureInbox creates an inbox on first use and reuses it after', () => {
  const store = newStore();
  const first = store.ensureInbox('240f00ce858a00');
  assert.equal(first.created, true);
  assert.equal(first.inbox.smtpUser, '240f00ce858a00');
  assert.equal(first.inbox.name, '240f00ce858a00');
  assert.equal(first.inbox.messageCount, 0);
  assert.equal(first.inbox.latestReceivedAt, null);

  const second = store.ensureInbox('240f00ce858a00');
  assert.equal(second.created, false);
  assert.equal(second.inbox.id, first.inbox.id);
  assert.equal(store.listInboxes().length, 1);
  store.close();
});

test('different SMTP users get different inboxes', () => {
  const store = newStore();
  const a = store.ensureInbox('app-one');
  const b = store.ensureInbox('app-two');
  assert.notEqual(a.inbox.id, b.inbox.id);
  assert.deepEqual(store.listInboxes().map((i) => i.smtpUser).sort(), ['app-one', 'app-two']);
  store.close();
});

test('renameInbox changes the display name but not the routing key', () => {
  const store = newStore();
  const { inbox } = store.ensureInbox('240f00ce858a00');
  const renamed = store.renameInbox(inbox.id, 'Call for Papers');
  assert.equal(renamed?.name, 'Call for Papers');
  assert.equal(renamed?.smtpUser, '240f00ce858a00');
  assert.equal(store.ensureInbox('240f00ce858a00').inbox.id, inbox.id);
  store.close();
});

test('renameInbox returns undefined for an unknown inbox', () => {
  const store = newStore();
  assert.equal(store.renameInbox(999, 'nope'), undefined);
  store.close();
});

test('schema survives reopening the same database file', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'mailtraxx-'));
  const path = join(dir, 'nested', 'test.db');

  const first = new SqliteStore(path, 500);
  first.ensureInbox('persisted');
  first.close();

  const second = new SqliteStore(path, 500);
  assert.equal(second.listInboxes()[0].smtpUser, 'persisted');
  second.close();
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test --workspace packages/server`
Expected: FAIL — cannot find module `./store.ts`.

- [ ] **Step 4: Write the implementation**

`packages/server/src/store.ts`. Note `node:sqlite` returns null-prototype row objects, so rows are mapped explicitly rather than spread.

```ts
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Inbox } from './types.ts';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inboxes (
  id         INTEGER PRIMARY KEY,
  smtp_user  TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY,
  inbox_id     INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  message_id   TEXT,
  from_addr    TEXT NOT NULL,
  from_display TEXT,
  to_addrs     TEXT NOT NULL,
  cc_addrs     TEXT,
  subject      TEXT,
  html         TEXT,
  text         TEXT,
  raw          TEXT NOT NULL,
  headers      TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  parse_error  TEXT,
  received_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_inbox_received
  ON messages(inbox_id, received_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id           INTEGER PRIMARY KEY,
  message_id   INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename     TEXT,
  content_type TEXT,
  size_bytes   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
`;

const INBOX_SELECT = `
  SELECT i.id, i.smtp_user, i.name, i.created_at,
         (SELECT COUNT(*) FROM messages m WHERE m.inbox_id = i.id)      AS message_count,
         (SELECT MAX(m.received_at) FROM messages m WHERE m.inbox_id = i.id) AS latest_received_at
  FROM inboxes i
`;

interface InboxRow {
  id: number;
  smtp_user: string;
  name: string;
  created_at: string;
  message_count: number;
  latest_received_at: string | null;
}

function toInbox(row: InboxRow): Inbox {
  return {
    id: row.id,
    smtpUser: row.smtp_user,
    name: row.name,
    createdAt: row.created_at,
    messageCount: row.message_count,
    latestReceivedAt: row.latest_received_at,
  };
}

export class SqliteStore {
  readonly #db: DatabaseSync;
  readonly #retain: number;

  constructor(dbPath: string, retain: number) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    try {
      this.#db = new DatabaseSync(dbPath);
      this.#db.exec(SCHEMA);
    } catch (cause) {
      throw new Error(`Cannot open the mailtraxx database at ${dbPath}: ${(cause as Error).message}`, { cause });
    }
    this.#retain = retain;
  }

  get db(): DatabaseSync {
    return this.#db;
  }

  get retain(): number {
    return this.#retain;
  }

  listInboxes(): Inbox[] {
    const rows = this.#db.prepare(`${INBOX_SELECT} ORDER BY i.name COLLATE NOCASE`).all() as unknown as InboxRow[];
    return rows.map(toInbox);
  }

  getInbox(id: number): Inbox | undefined {
    const row = this.#db.prepare(`${INBOX_SELECT} WHERE i.id = ?`).get(id) as unknown as InboxRow | undefined;
    return row ? toInbox(row) : undefined;
  }

  ensureInbox(smtpUser: string): { inbox: Inbox; created: boolean } {
    const existing = this.#db
      .prepare(`${INBOX_SELECT} WHERE i.smtp_user = ?`)
      .get(smtpUser) as unknown as InboxRow | undefined;
    if (existing) return { inbox: toInbox(existing), created: false };

    const { lastInsertRowid } = this.#db
      .prepare('INSERT INTO inboxes (smtp_user, name, created_at) VALUES (?, ?, ?)')
      .run(smtpUser, smtpUser, new Date().toISOString());

    return { inbox: this.getInbox(Number(lastInsertRowid))!, created: true };
  }

  renameInbox(id: number, name: string): Inbox | undefined {
    const { changes } = this.#db.prepare('UPDATE inboxes SET name = ? WHERE id = ?').run(name, id);
    return changes === 0 ? undefined : this.getInbox(id);
  }

  close(): void {
    this.#db.close();
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace packages/server`
Expected: PASS — 9 tests total.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/types.ts packages/server/src/store.ts packages/server/src/store.inboxes.test.ts
git commit -m "feat: add SQLite store with inbox creation and rename"
```

---

### Task 3: Store — messages, search, and retention

**Files:**
- Modify: `packages/server/src/store.ts` (add message methods to `SqliteStore`)
- Test: `packages/server/src/store.messages.test.ts`

**Interfaces:**
- Consumes: `SqliteStore`, `Inbox`, `ParsedMessage`, `Message`, `MessageSummary`, `SaveResult` from Task 2.
- Produces, on `SqliteStore`:
  - `saveMessage(m: ParsedMessage): SaveResult`
  - `listMessages(inboxId: number, opts: { q?: string; limit: number; offset: number }): MessageSummary[]`
  - `getMessage(id: number): Message | undefined`
  - `deleteMessage(id: number): { inboxId: number } | undefined`
  - `clearInbox(inboxId: number): number` (returns rows deleted)

- [ ] **Step 1: Write the failing test**

`packages/server/src/store.messages.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from './store.ts';
import type { ParsedMessage } from './types.ts';

function msg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    smtpUser: 'cfp',
    messageId: '<abc@cfp.dev>',
    fromAddr: 'no_reply+dev@cfp.dev',
    fromDisplay: 'Devoxx CFP <no_reply+dev@cfp.dev>',
    toAddrs: ['speaker@example.com'],
    ccAddrs: [],
    subject: 'Your talk was accepted',
    html: '<h1>Accepted</h1>',
    text: 'Accepted',
    raw: 'Subject: Your talk was accepted\r\n\r\nAccepted',
    headers: { subject: 'Your talk was accepted' },
    sizeBytes: 42,
    parseError: null,
    attachments: [],
    receivedAt: '2026-08-12T10:00:00.000Z',
    ...overrides,
  };
}

test('saveMessage creates the inbox and reports it as new', () => {
  const store = new SqliteStore(':memory:', 500);
  const result = store.saveMessage(msg());
  assert.equal(result.inboxCreated, true);
  assert.equal(result.inbox.smtpUser, 'cfp');
  assert.equal(result.message.subject, 'Your talk was accepted');
  assert.deepEqual(result.message.toAddrs, ['speaker@example.com']);
  assert.equal(result.message.hasHtml, true);
  assert.equal(store.getInbox(result.inbox.id)?.messageCount, 1);

  const second = store.saveMessage(msg({ subject: 'Second' }));
  assert.equal(second.inboxCreated, false);
  store.close();
});

test('getMessage returns the full body, headers, and attachment metadata', () => {
  const store = new SqliteStore(':memory:', 500);
  const saved = store.saveMessage(
    msg({ attachments: [{ filename: 'slides.pdf', contentType: 'application/pdf', sizeBytes: 1234 }] }),
  );
  const full = store.getMessage(saved.message.id)!;
  assert.equal(full.html, '<h1>Accepted</h1>');
  assert.equal(full.text, 'Accepted');
  assert.equal(full.raw, 'Subject: Your talk was accepted\r\n\r\nAccepted');
  assert.deepEqual(full.headers, { subject: 'Your talk was accepted' });
  assert.deepEqual(full.attachments, [
    { filename: 'slides.pdf', contentType: 'application/pdf', sizeBytes: 1234 },
  ]);
  assert.equal(store.getMessage(999), undefined);
  store.close();
});

test('a message that failed to parse still keeps its raw source', () => {
  const store = new SqliteStore(':memory:', 500);
  const saved = store.saveMessage(
    msg({ parseError: 'Unexpected end of multipart', html: null, text: null, subject: null, raw: 'garbage' }),
  );
  const full = store.getMessage(saved.message.id)!;
  assert.equal(full.parseError, 'Unexpected end of multipart');
  assert.equal(full.raw, 'garbage');
  assert.equal(full.hasHtml, false);
  store.close();
});

test('listMessages returns newest first and pages', () => {
  const store = new SqliteStore(':memory:', 500);
  for (let i = 0; i < 5; i++) {
    store.saveMessage(msg({ subject: `Message ${i}`, receivedAt: `2026-08-12T10:0${i}:00.000Z` }));
  }
  const inboxId = store.listInboxes()[0].id;

  const firstPage = store.listMessages(inboxId, { limit: 2, offset: 0 });
  assert.deepEqual(firstPage.map((m) => m.subject), ['Message 4', 'Message 3']);

  const secondPage = store.listMessages(inboxId, { limit: 2, offset: 2 });
  assert.deepEqual(secondPage.map((m) => m.subject), ['Message 2', 'Message 1']);
  store.close();
});

test('listMessages search matches subject, sender, and recipient, case-insensitively', () => {
  const store = new SqliteStore(':memory:', 500);
  store.saveMessage(msg({ subject: 'Talk accepted', toAddrs: ['alice@example.com'] }));
  store.saveMessage(msg({ subject: 'Password reset', toAddrs: ['bob@example.com'] }));
  const inboxId = store.listInboxes()[0].id;

  assert.equal(store.listMessages(inboxId, { q: 'accepted', limit: 50, offset: 0 }).length, 1);
  assert.equal(store.listMessages(inboxId, { q: 'BOB@', limit: 50, offset: 0 }).length, 1);
  assert.equal(store.listMessages(inboxId, { q: 'devoxx cfp', limit: 50, offset: 0 }).length, 2);
  assert.equal(store.listMessages(inboxId, { q: 'nothing', limit: 50, offset: 0 }).length, 0);
});

test('search treats % and _ as literal characters, not wildcards', () => {
  const store = new SqliteStore(':memory:', 500);
  store.saveMessage(msg({ subject: '50% off' }));
  store.saveMessage(msg({ subject: 'nothing special' }));
  const inboxId = store.listInboxes()[0].id;
  assert.equal(store.listMessages(inboxId, { q: '%', limit: 50, offset: 0 }).length, 1);
  store.close();
});

test('retention keeps only the newest N messages per inbox', () => {
  const store = new SqliteStore(':memory:', 3);
  for (let i = 0; i < 6; i++) {
    store.saveMessage(msg({ subject: `Message ${i}`, receivedAt: `2026-08-12T10:0${i}:00.000Z` }));
  }
  const inboxId = store.listInboxes()[0].id;
  const kept = store.listMessages(inboxId, { limit: 50, offset: 0 });
  assert.deepEqual(kept.map((m) => m.subject), ['Message 5', 'Message 4', 'Message 3']);
  assert.equal(store.getInbox(inboxId)?.messageCount, 3);
  store.close();
});

test('retention is per inbox, not global', () => {
  const store = new SqliteStore(':memory:', 2);
  for (let i = 0; i < 3; i++) store.saveMessage(msg({ smtpUser: 'app-one', receivedAt: `2026-08-12T10:0${i}:00.000Z` }));
  for (let i = 0; i < 3; i++) store.saveMessage(msg({ smtpUser: 'app-two', receivedAt: `2026-08-12T10:0${i}:00.000Z` }));
  for (const inbox of store.listInboxes()) assert.equal(inbox.messageCount, 2);
  store.close();
});

test('pruned messages take their attachment rows with them', () => {
  const store = new SqliteStore(':memory:', 1);
  store.saveMessage(msg({ attachments: [{ filename: 'old.pdf', contentType: 'application/pdf', sizeBytes: 1 }] }));
  store.saveMessage(msg({ receivedAt: '2026-08-12T11:00:00.000Z' }));
  const orphans = store.db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as unknown as { n: number };
  assert.equal(orphans.n, 0);
  store.close();
});

test('deleteMessage removes one message and reports its inbox', () => {
  const store = new SqliteStore(':memory:', 500);
  const saved = store.saveMessage(msg());
  assert.deepEqual(store.deleteMessage(saved.message.id), { inboxId: saved.inbox.id });
  assert.equal(store.getMessage(saved.message.id), undefined);
  assert.equal(store.deleteMessage(saved.message.id), undefined);
  store.close();
});

test('clearInbox empties one inbox and leaves the others alone', () => {
  const store = new SqliteStore(':memory:', 500);
  store.saveMessage(msg({ smtpUser: 'app-one' }));
  store.saveMessage(msg({ smtpUser: 'app-one' }));
  store.saveMessage(msg({ smtpUser: 'app-two' }));
  const one = store.listInboxes().find((i) => i.smtpUser === 'app-one')!;
  const two = store.listInboxes().find((i) => i.smtpUser === 'app-two')!;

  assert.equal(store.clearInbox(one.id), 2);
  assert.equal(store.getInbox(one.id)?.messageCount, 0);
  assert.equal(store.getInbox(two.id)?.messageCount, 1);
  store.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace packages/server`
Expected: FAIL — `store.saveMessage is not a function`.

- [ ] **Step 3: Add the message imports and row mappers to `store.ts`**

Extend the import at the top of `packages/server/src/store.ts`:

```ts
import type { Inbox, Message, MessageSummary, ParsedMessage, SaveResult, AttachmentMeta } from './types.ts';
```

Add below `toInbox`:

```ts
const SUMMARY_COLUMNS = `
  id, inbox_id, from_display, to_addrs, subject, size_bytes,
  (html IS NOT NULL) AS has_html, parse_error, received_at
`;

interface SummaryRow {
  id: number;
  inbox_id: number;
  from_display: string | null;
  to_addrs: string;
  subject: string | null;
  size_bytes: number;
  has_html: number;
  parse_error: string | null;
  received_at: string;
}

interface MessageRow extends SummaryRow {
  message_id: string | null;
  from_addr: string;
  cc_addrs: string | null;
  html: string | null;
  text: string | null;
  raw: string;
  headers: string;
}

function toSummary(row: SummaryRow): MessageSummary {
  return {
    id: row.id,
    inboxId: row.inbox_id,
    fromDisplay: row.from_display,
    toAddrs: JSON.parse(row.to_addrs) as string[],
    subject: row.subject,
    sizeBytes: row.size_bytes,
    hasHtml: row.has_html === 1,
    parseError: row.parse_error,
    receivedAt: row.received_at,
  };
}

/** Escapes LIKE wildcards so a search for "50%" doesn't match everything. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
```

- [ ] **Step 4: Add the message methods to `SqliteStore`**

Insert these methods into the `SqliteStore` class, before `close()`:

```ts
  saveMessage(m: ParsedMessage): SaveResult {
    const { inbox, created } = this.ensureInbox(m.smtpUser);

    const { lastInsertRowid } = this.#db
      .prepare(
        `INSERT INTO messages
           (inbox_id, message_id, from_addr, from_display, to_addrs, cc_addrs,
            subject, html, text, raw, headers, size_bytes, parse_error, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        inbox.id,
        m.messageId,
        m.fromAddr,
        m.fromDisplay,
        JSON.stringify(m.toAddrs),
        JSON.stringify(m.ccAddrs),
        m.subject,
        m.html,
        m.text,
        m.raw,
        JSON.stringify(m.headers),
        m.sizeBytes,
        m.parseError,
        m.receivedAt,
      );

    const messageId = Number(lastInsertRowid);
    const insertAttachment = this.#db.prepare(
      'INSERT INTO attachments (message_id, filename, content_type, size_bytes) VALUES (?, ?, ?, ?)',
    );
    for (const a of m.attachments) {
      insertAttachment.run(messageId, a.filename, a.contentType, a.sizeBytes);
    }

    this.#prune(inbox.id);

    const row = this.#db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM messages WHERE id = ?`)
      .get(messageId) as unknown as SummaryRow;

    return { message: toSummary(row), inbox: this.getInbox(inbox.id)!, inboxCreated: created };
  }

  listMessages(inboxId: number, opts: { q?: string; limit: number; offset: number }): MessageSummary[] {
    const q = opts.q?.trim();
    const sql = `
      SELECT ${SUMMARY_COLUMNS} FROM messages
      WHERE inbox_id = ?
      ${q ? `AND (subject LIKE ?2 ESCAPE '\\' OR from_display LIKE ?2 ESCAPE '\\' OR to_addrs LIKE ?2 ESCAPE '\\')` : ''}
      ORDER BY received_at DESC, id DESC
      LIMIT ? OFFSET ?`;

    const rows = q
      ? this.#db.prepare(sql).all(inboxId, likePattern(q), opts.limit, opts.offset)
      : this.#db.prepare(sql).all(inboxId, opts.limit, opts.offset);

    return (rows as unknown as SummaryRow[]).map(toSummary);
  }

  getMessage(id: number): Message | undefined {
    const row = this.#db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as MessageRow | undefined;
    if (!row) return undefined;

    const attachments = this.#db
      .prepare('SELECT filename, content_type, size_bytes FROM attachments WHERE message_id = ? ORDER BY id')
      .all(id) as unknown as { filename: string | null; content_type: string | null; size_bytes: number }[];

    return {
      ...toSummary(row),
      messageId: row.message_id,
      fromAddr: row.from_addr,
      ccAddrs: JSON.parse(row.cc_addrs ?? '[]') as string[],
      html: row.html,
      text: row.text,
      raw: row.raw,
      headers: JSON.parse(row.headers) as Record<string, string>,
      attachments: attachments.map((a): AttachmentMeta => ({
        filename: a.filename,
        contentType: a.content_type,
        sizeBytes: a.size_bytes,
      })),
    };
  }

  deleteMessage(id: number): { inboxId: number } | undefined {
    const row = this.#db.prepare('SELECT inbox_id FROM messages WHERE id = ?').get(id) as unknown as
      | { inbox_id: number }
      | undefined;
    if (!row) return undefined;
    this.#db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    return { inboxId: row.inbox_id };
  }

  clearInbox(inboxId: number): number {
    const { changes } = this.#db.prepare('DELETE FROM messages WHERE inbox_id = ?').run(inboxId);
    return Number(changes);
  }

  /** Keeps only the newest `retain` messages in one inbox. */
  #prune(inboxId: number): void {
    this.#db
      .prepare(
        `DELETE FROM messages
          WHERE inbox_id = ?1
            AND id NOT IN (
              SELECT id FROM messages WHERE inbox_id = ?1
              ORDER BY received_at DESC, id DESC LIMIT ?2
            )`,
      )
      .run(inboxId, this.#retain);
  }
```

Note: `PRAGMA foreign_keys = ON` in the schema is what makes attachment rows disappear with their message.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace packages/server`
Expected: PASS — 20 tests total. If the wildcard-escaping test fails, check that `ESCAPE '\\'` survived into the SQL string.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/store.ts packages/server/src/store.messages.test.ts
git commit -m "feat: add message persistence, search, and per-inbox retention"
```

---

### Task 4: MIME parsing

Turns a raw RFC822 buffer plus an SMTP session into a `ParsedMessage`. Isolated from the SMTP server so parser edge cases are testable without sockets.

**Files:**
- Create: `packages/server/src/parse.ts`
- Test: `packages/server/src/parse.test.ts`

**Interfaces:**
- Consumes: `ParsedMessage`, `AttachmentMeta` from Task 2.
- Produces: `parseMessage(raw: Buffer, envelope: EnvelopeInfo): Promise<ParsedMessage>` and `interface EnvelopeInfo { smtpUser: string; mailFrom: string; rcptTo: string[]; receivedAt: string }` from `packages/server/src/parse.ts`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/parse.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from './parse.ts';
import type { EnvelopeInfo } from './parse.ts';

const envelope: EnvelopeInfo = {
  smtpUser: 'cfp',
  mailFrom: 'no_reply+dev@cfp.dev',
  rcptTo: ['speaker@example.com'],
  receivedAt: '2026-08-12T10:00:00.000Z',
};

function raw(body: string): Buffer {
  return Buffer.from(body.replace(/\n/g, '\r\n'), 'utf8');
}

test('parses a multipart message with both html and text parts', async () => {
  const source = raw(
    [
      'From: Devoxx CFP <no_reply+dev@cfp.dev>',
      'To: speaker@example.com',
      'Cc: chair@example.com',
      'Subject: Your talk was accepted',
      'Message-ID: <abc@cfp.dev>',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Accepted',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<h1>Accepted</h1>',
      '--b1--',
      '',
    ].join('\n'),
  );

  const m = await parseMessage(source, envelope);
  assert.equal(m.subject, 'Your talk was accepted');
  assert.equal(m.text?.trim(), 'Accepted');
  assert.equal(m.html?.trim(), '<h1>Accepted</h1>');
  assert.equal(m.fromDisplay, 'Devoxx CFP <no_reply+dev@cfp.dev>');
  assert.equal(m.messageId, '<abc@cfp.dev>');
  assert.deepEqual(m.ccAddrs, ['chair@example.com']);
  assert.equal(m.parseError, null);
  assert.equal(m.sizeBytes, source.length);
  assert.equal(m.raw, source.toString('utf8'));
});

test('envelope recipients win over To: headers, because that is who actually gets it', async () => {
  const source = raw(['To: displayed@example.com', 'Subject: Hi', '', 'Body', ''].join('\n'));
  const m = await parseMessage(source, { ...envelope, rcptTo: ['real@example.com', 'bcc@example.com'] });
  assert.deepEqual(m.toAddrs, ['real@example.com', 'bcc@example.com']);
  assert.equal(m.fromAddr, 'no_reply+dev@cfp.dev');
});

test('a text-only message has no html', async () => {
  const m = await parseMessage(raw(['Subject: Plain', '', 'Just text', ''].join('\n')), envelope);
  assert.equal(m.html, null);
  assert.equal(m.text?.trim(), 'Just text');
});

test('an html-only message has no text', async () => {
  const source = raw(['Subject: Rich', 'Content-Type: text/html; charset=utf-8', '', '<p>Rich</p>', ''].join('\n'));
  const m = await parseMessage(source, envelope);
  assert.equal(m.html?.trim(), '<p>Rich</p>');
  assert.equal(m.text, null);
});

test('a message with no Subject parses with a null subject', async () => {
  const m = await parseMessage(raw(['From: a@b.c', '', 'Body', ''].join('\n')), envelope);
  assert.equal(m.subject, null);
  assert.equal(m.parseError, null);
});

test('quoted-printable and UTF-8 subjects are decoded', async () => {
  const source = raw(
    [
      'Subject: =?utf-8?Q?Caf=C3=A9_r=C3=A9serv=C3=A9?=',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Caf=C3=A9',
      '',
    ].join('\n'),
  );
  const m = await parseMessage(source, envelope);
  assert.equal(m.subject, 'Café réservé');
  assert.equal(m.text?.trim(), 'Café');
});

test('attachment metadata is captured but content is not', async () => {
  const source = raw(
    [
      'Subject: With attachment',
      'Content-Type: multipart/mixed; boundary="b2"',
      '',
      '--b2',
      'Content-Type: text/plain',
      '',
      'See attached',
      '--b2',
      'Content-Type: application/pdf; name="slides.pdf"',
      'Content-Disposition: attachment; filename="slides.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'aGVsbG8=',
      '--b2--',
      '',
    ].join('\n'),
  );
  const m = await parseMessage(source, envelope);
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'slides.pdf');
  assert.equal(m.attachments[0].contentType, 'application/pdf');
  assert.equal(m.attachments[0].sizeBytes, 5);
  assert.ok(!('content' in m.attachments[0]));
});

test('headers are flattened to a plain string map', async () => {
  const m = await parseMessage(raw(['Subject: Hi', 'X-Custom: value', '', 'Body', ''].join('\n')), envelope);
  assert.equal(m.headers['x-custom'], 'value');
  assert.equal(typeof m.headers['subject'], 'string');
});

test('unparseable input still yields a message with raw preserved', async () => {
  const source = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
  const m = await parseMessage(source, envelope);
  assert.equal(m.raw.length > 0, true);
  assert.equal(m.sizeBytes, 4);
  assert.equal(m.toAddrs.length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace packages/server`
Expected: FAIL — cannot find module `./parse.ts`.

- [ ] **Step 3: Write the implementation**

`packages/server/src/parse.ts`:

```ts
import { simpleParser } from 'mailparser';
import type { ParsedMessage, AttachmentMeta } from './types.ts';

export interface EnvelopeInfo {
  smtpUser: string;
  mailFrom: string;
  rcptTo: string[];
  receivedAt: string;
}

function flattenHeaders(headers: Map<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of headers) {
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

function ccAddresses(parsed: Awaited<ReturnType<typeof simpleParser>>): string[] {
  const cc = parsed.cc;
  if (!cc) return [];
  const list = Array.isArray(cc) ? cc : [cc];
  return list.flatMap((entry) => entry.value.map((v) => v.address ?? '')).filter(Boolean);
}

/**
 * Parses raw RFC822 into a storable message. Never throws: a parse failure
 * still produces a record carrying the raw source and a `parseError`, because
 * losing the message is worse than losing the parse.
 */
export async function parseMessage(raw: Buffer, envelope: EnvelopeInfo): Promise<ParsedMessage> {
  const base: ParsedMessage = {
    smtpUser: envelope.smtpUser,
    messageId: null,
    fromAddr: envelope.mailFrom,
    fromDisplay: null,
    toAddrs: envelope.rcptTo,
    ccAddrs: [],
    subject: null,
    html: null,
    text: null,
    raw: raw.toString('utf8'),
    headers: {},
    sizeBytes: raw.length,
    parseError: null,
    attachments: [],
    receivedAt: envelope.receivedAt,
  };

  try {
    const parsed = await simpleParser(raw);
    return {
      ...base,
      messageId: parsed.messageId ?? null,
      fromDisplay: parsed.from?.text ?? null,
      ccAddrs: ccAddresses(parsed),
      subject: parsed.subject ?? null,
      html: typeof parsed.html === 'string' ? parsed.html : null,
      text: parsed.text ?? null,
      headers: flattenHeaders(parsed.headers as Map<string, unknown>),
      attachments: parsed.attachments.map(
        (a): AttachmentMeta => ({
          filename: a.filename ?? null,
          contentType: a.contentType ?? null,
          sizeBytes: a.size,
        }),
      ),
    };
  } catch (cause) {
    return { ...base, parseError: (cause as Error).message };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace packages/server`
Expected: PASS — 29 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/parse.ts packages/server/src/parse.test.ts
git commit -m "feat: parse MIME into storable messages, preserving raw on failure"
```

---

### Task 5: SMTP server

**Files:**
- Create: `packages/server/src/smtp.ts`
- Test: `packages/server/src/smtp.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1), `SqliteStore` (Tasks 2–3), `parseMessage`/`EnvelopeInfo` (Task 4).
- Produces: `startSmtpServer(config: Config, store: SqliteStore, onSaved?: (r: SaveResult) => void): Promise<SmtpHandle>` where `interface SmtpHandle { port: number; close(): Promise<void> }`. Task 8 replaces the `onSaved` callback with the event bus.

Behaviour this task locks in, from the spec: any username/password accepted; unauthenticated mail lands in `default`; oversized mail gets `552`; a store failure gets `451`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/smtp.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { startSmtpServer } from './smtp.ts';
import { SqliteStore } from './store.ts';
import { parseConfig } from './config.ts';
import type { SaveResult } from './types.ts';

async function harness(overrides: string[] = []) {
  const config = parseConfig(['--smtp-port', '0', ...overrides]);
  const store = new SqliteStore(':memory:', config.retain);
  const saved: SaveResult[] = [];
  const smtp = await startSmtpServer(config, store, (r) => saved.push(r));
  const transport = nodemailer.createTransport({
    host: '127.0.0.1',
    port: smtp.port,
    secure: false,
    auth: { user: '240f00ce858a00', pass: 'b6cba990e80601' },
  });
  return {
    store,
    saved,
    transport,
    async close() {
      transport.close();
      await smtp.close();
      store.close();
    },
  };
}

test('accepts authenticated mail and files it under the SMTP username', async () => {
  const h = await harness();
  await h.transport.sendMail({
    from: 'no_reply+dev@cfp.dev',
    to: 'speaker@example.com',
    subject: 'Your talk was accepted',
    html: '<h1>Accepted</h1>',
    text: 'Accepted',
  });

  assert.equal(h.saved.length, 1);
  const inbox = h.store.listInboxes()[0];
  assert.equal(inbox.smtpUser, '240f00ce858a00');
  const message = h.store.listMessages(inbox.id, { limit: 50, offset: 0 })[0];
  assert.equal(message.subject, 'Your talk was accepted');
  assert.deepEqual(message.toAddrs, ['speaker@example.com']);
  await h.close();
});

test('accepts any password, because it is a local capture server', async () => {
  const h = await harness();
  const anyPassword = nodemailer.createTransport({
    host: '127.0.0.1',
    port: (h.transport.options as { port: number }).port,
    secure: false,
    auth: { user: 'other-app', pass: 'literally-anything' },
  });
  await anyPassword.sendMail({ from: 'a@b.c', to: 'd@e.f', subject: 'Hi', text: 'Hi' });
  assert.deepEqual(h.store.listInboxes().map((i) => i.smtpUser), ['other-app']);
  anyPassword.close();
  await h.close();
});

test('unauthenticated mail lands in the default inbox', async () => {
  const h = await harness();
  const anon = nodemailer.createTransport({
    host: '127.0.0.1',
    port: (h.transport.options as { port: number }).port,
    secure: false,
  });
  await anon.sendMail({ from: 'a@b.c', to: 'd@e.f', subject: 'Anon', text: 'Anon' });
  assert.deepEqual(h.store.listInboxes().map((i) => i.smtpUser), ['default']);
  anon.close();
  await h.close();
});

test('rejects a message over the size limit with 552 and stores nothing', async () => {
  const h = await harness(['--max-size', '1']);
  await assert.rejects(
    h.transport.sendMail({
      from: 'a@b.c',
      to: 'd@e.f',
      subject: 'Huge',
      text: 'x'.repeat(2 * 1024 * 1024),
    }),
    (err: Error & { responseCode?: number }) => {
      assert.equal(err.responseCode, 552);
      return true;
    },
  );
  assert.equal(h.store.listInboxes().length, 0);
  await h.close();
});

test('a store failure is reported to the sender as 451, never silently dropped', async () => {
  const config = parseConfig(['--smtp-port', '0']);
  const store = new SqliteStore(':memory:', config.retain);
  store.saveMessage = () => {
    throw new Error('disk on fire');
  };
  const smtp = await startSmtpServer(config, store);
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: smtp.port, secure: false });

  await assert.rejects(
    transport.sendMail({ from: 'a@b.c', to: 'd@e.f', subject: 'Doomed', text: 'Doomed' }),
    (err: Error & { responseCode?: number }) => {
      assert.equal(err.responseCode, 451);
      return true;
    },
  );

  transport.close();
  await smtp.close();
  store.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace packages/server`
Expected: FAIL — cannot find module `./smtp.ts`.

- [ ] **Step 3: Write the implementation**

`packages/server/src/smtp.ts`. `disabledCommands: ['STARTTLS']` plus `allowInsecureAuth: true` is what makes Jakarta Mail's opportunistic `starttls.enable=true` fall back to plaintext AUTH instead of failing.

```ts
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

    // Any credentials are accepted; the username selects the inbox.
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

          try {
            const result = store.saveMessage(parsed);
            onSaved?.(result);
            callback(null, 'Message captured by mailtraxx');
          } catch (cause) {
            const err = new Error(`Could not store message: ${(cause as Error).message}`) as Error & {
              responseCode?: number;
            };
            err.responseCode = 451;
            callback(err);
          }
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace packages/server`
Expected: PASS — 34 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/smtp.ts packages/server/src/smtp.test.ts
git commit -m "feat: add SMTP capture server routing mail to inboxes by username"
```

---

### Task 6: Event bus

A ~30-line publish/subscribe unit. Small, but it is the seam between SMTP capture and the browser, so it gets its own tests.

**Files:**
- Create: `packages/server/src/bus.ts`
- Test: `packages/server/src/bus.test.ts`

**Interfaces:**
- Consumes: `Inbox`, `MessageSummary` from Task 2.
- Produces from `packages/server/src/bus.ts`:
  - `type MailtraxxEvent = { type: 'message.created'; message: MessageSummary } | { type: 'inbox.created'; inbox: Inbox } | { type: 'message.deleted'; id: number; inboxId: number } | { type: 'messages.cleared'; inboxId: number }`
  - `class EventBus` with `subscribe(listener: (e: MailtraxxEvent) => void): () => void` (returns an unsubscribe function) and `emit(event: MailtraxxEvent): void`

- [ ] **Step 1: Write the failing test**

`packages/server/src/bus.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from './bus.ts';
import type { MailtraxxEvent } from './bus.ts';

const cleared: MailtraxxEvent = { type: 'messages.cleared', inboxId: 1 };

test('delivers events to every subscriber', () => {
  const bus = new EventBus();
  const a: MailtraxxEvent[] = [];
  const b: MailtraxxEvent[] = [];
  bus.subscribe((e) => a.push(e));
  bus.subscribe((e) => b.push(e));
  bus.emit(cleared);
  assert.deepEqual(a, [cleared]);
  assert.deepEqual(b, [cleared]);
});

test('unsubscribing stops delivery', () => {
  const bus = new EventBus();
  const seen: MailtraxxEvent[] = [];
  const off = bus.subscribe((e) => seen.push(e));
  bus.emit(cleared);
  off();
  bus.emit(cleared);
  assert.equal(seen.length, 1);
});

test('one throwing subscriber does not stop the others', () => {
  const bus = new EventBus();
  const seen: MailtraxxEvent[] = [];
  bus.subscribe(() => {
    throw new Error('subscriber exploded');
  });
  bus.subscribe((e) => seen.push(e));
  assert.doesNotThrow(() => bus.emit(cleared));
  assert.equal(seen.length, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace packages/server`
Expected: FAIL — cannot find module `./bus.ts`.

- [ ] **Step 3: Write the implementation**

`packages/server/src/bus.ts`:

```ts
import type { Inbox, MessageSummary } from './types.ts';

export type MailtraxxEvent =
  | { type: 'message.created'; message: MessageSummary }
  | { type: 'inbox.created'; inbox: Inbox }
  | { type: 'message.deleted'; id: number; inboxId: number }
  | { type: 'messages.cleared'; inboxId: number };

export type EventListener = (event: MailtraxxEvent) => void;

export class EventBus {
  readonly #listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: MailtraxxEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (err) {
        // A dead SSE connection must not take down mail capture.
        console.error('mailtraxx: event listener failed:', err);
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace packages/server`
Expected: PASS — 37 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bus.ts packages/server/src/bus.test.ts
git commit -m "feat: add in-process event bus"
```

---

### Task 7: JSON API and SSE

The HTTP surface: every route from the spec plus the live stream.

**Files:**
- Create: `packages/server/src/api.ts`
- Test: `packages/server/src/api.test.ts`

**Interfaces:**
- Consumes: `SqliteStore` (Tasks 2–3), `EventBus`/`MailtraxxEvent` (Task 6).
- Produces: `handleApi(req: IncomingMessage, res: ServerResponse, store: SqliteStore, bus: EventBus): boolean` from `packages/server/src/api.ts` — returns `true` if the request was an `/api/*` request it handled, `false` if the caller should fall through to static file serving. Task 8 wires it into the HTTP server.

- [ ] **Step 1: Write the failing test**

`packages/server/src/api.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleApi } from './api.ts';
import { SqliteStore } from './store.ts';
import { EventBus } from './bus.ts';
import type { ParsedMessage } from './types.ts';

function msg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    smtpUser: 'cfp',
    messageId: '<abc@cfp.dev>',
    fromAddr: 'no_reply+dev@cfp.dev',
    fromDisplay: 'Devoxx CFP <no_reply+dev@cfp.dev>',
    toAddrs: ['speaker@example.com'],
    ccAddrs: [],
    subject: 'Your talk was accepted',
    html: '<h1>Accepted</h1>',
    text: 'Accepted',
    raw: 'Subject: Your talk was accepted\r\n\r\nAccepted',
    headers: { subject: 'Your talk was accepted' },
    sizeBytes: 42,
    parseError: null,
    attachments: [],
    receivedAt: '2026-08-12T10:00:00.000Z',
    ...overrides,
  };
}

async function harness() {
  const store = new SqliteStore(':memory:', 500);
  const bus = new EventBus();
  const server = createServer((req, res) => {
    if (!handleApi(req, res, store, bus)) {
      res.writeHead(404).end('not api');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    store,
    bus,
    base,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
    },
  };
}

test('GET /api/inboxes lists inboxes with counts', async () => {
  const h = await harness();
  h.store.saveMessage(msg());
  const res = await fetch(`${h.base}/api/inboxes`);
  assert.equal(res.status, 200);
  const inboxes = await res.json();
  assert.equal(inboxes.length, 1);
  assert.equal(inboxes[0].smtpUser, 'cfp');
  assert.equal(inboxes[0].messageCount, 1);
  await h.close();
});

test('PATCH /api/inboxes/:id renames', async () => {
  const h = await harness();
  const { inbox } = h.store.ensureInbox('cfp');
  const res = await fetch(`${h.base}/api/inboxes/${inbox.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Call for Papers' }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, 'Call for Papers');
  assert.equal((await (await fetch(`${h.base}/api/inboxes/999`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  })).status), 404);
  await h.close();
});

test('GET /api/inboxes/:id/messages supports search and paging', async () => {
  const h = await harness();
  h.store.saveMessage(msg({ subject: 'Talk accepted', receivedAt: '2026-08-12T10:00:00.000Z' }));
  h.store.saveMessage(msg({ subject: 'Password reset', receivedAt: '2026-08-12T11:00:00.000Z' }));
  const id = h.store.listInboxes()[0].id;

  const all = await (await fetch(`${h.base}/api/inboxes/${id}/messages`)).json();
  assert.deepEqual(all.map((m: { subject: string }) => m.subject), ['Password reset', 'Talk accepted']);

  const searched = await (await fetch(`${h.base}/api/inboxes/${id}/messages?q=accepted`)).json();
  assert.equal(searched.length, 1);

  const paged = await (await fetch(`${h.base}/api/inboxes/${id}/messages?limit=1&offset=1`)).json();
  assert.deepEqual(paged.map((m: { subject: string }) => m.subject), ['Talk accepted']);
  await h.close();
});

test('GET /api/messages/:id returns the full message, and 404s when missing', async () => {
  const h = await harness();
  const saved = h.store.saveMessage(msg());
  const full = await (await fetch(`${h.base}/api/messages/${saved.message.id}`)).json();
  assert.equal(full.html, '<h1>Accepted</h1>');
  assert.equal(full.raw, 'Subject: Your talk was accepted\r\n\r\nAccepted');
  assert.equal((await fetch(`${h.base}/api/messages/999`)).status, 404);
  await h.close();
});

test('GET /api/messages/:id/raw downloads the source as .eml', async () => {
  const h = await harness();
  const saved = h.store.saveMessage(msg());
  const res = await fetch(`${h.base}/api/messages/${saved.message.id}/raw`);
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  assert.equal(res.headers.get('content-disposition'), `attachment; filename="message-${saved.message.id}.eml"`);
  assert.equal(await res.text(), 'Subject: Your talk was accepted\r\n\r\nAccepted');
  await h.close();
});

test('DELETE /api/messages/:id removes it and emits an event', async () => {
  const h = await harness();
  const saved = h.store.saveMessage(msg());
  const events: string[] = [];
  h.bus.subscribe((e) => events.push(e.type));

  assert.equal((await fetch(`${h.base}/api/messages/${saved.message.id}`, { method: 'DELETE' })).status, 204);
  assert.equal(h.store.getMessage(saved.message.id), undefined);
  assert.deepEqual(events, ['message.deleted']);
  assert.equal((await fetch(`${h.base}/api/messages/${saved.message.id}`, { method: 'DELETE' })).status, 404);
  await h.close();
});

test('DELETE /api/inboxes/:id/messages clears it and emits an event', async () => {
  const h = await harness();
  h.store.saveMessage(msg());
  const id = h.store.listInboxes()[0].id;
  const events: string[] = [];
  h.bus.subscribe((e) => events.push(e.type));

  assert.equal((await fetch(`${h.base}/api/inboxes/${id}/messages`, { method: 'DELETE' })).status, 204);
  assert.equal(h.store.getInbox(id)?.messageCount, 0);
  assert.deepEqual(events, ['messages.cleared']);
  await h.close();
});

test('GET /api/events streams bus events as SSE', async () => {
  const h = await harness();
  const controller = new AbortController();
  const res = await fetch(`${h.base}/api/events`, { signal: controller.signal });
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /^: connected/);

  h.store.saveMessage(msg());
  h.bus.emit({ type: 'messages.cleared', inboxId: 1 });
  const next = await reader.read();
  const chunk = new TextDecoder().decode(next.value);
  assert.match(chunk, /data: /);
  assert.match(chunk, /messages\.cleared/);

  controller.abort();
  await h.close();
});

test('an unknown /api path is a JSON 404, and non-api paths fall through', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/api/nope`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.equal((await res.json()).error, 'Not found');

  assert.equal(await (await fetch(`${h.base}/index.html`)).text(), 'not api');
  await h.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace packages/server`
Expected: FAIL — cannot find module `./api.ts`.

- [ ] **Step 3: Write the implementation**

`packages/server/src/api.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SqliteStore } from './store.ts';
import type { EventBus } from './bus.ts';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'Not found' });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function streamEvents(res: ServerResponse, bus: EventBus, req: IncomingMessage): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  const unsubscribe = bus.subscribe((event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  // Keeps proxies and idle sockets from dropping a quiet stream.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

  const stop = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', stop);
  res.on('close', stop);
}

/**
 * Handles /api/* requests. Returns false for anything else so the caller can
 * fall through to static file serving.
 */
export function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  store: SqliteStore,
  bus: EventBus,
): boolean {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;

  const segments = url.pathname.split('/').filter(Boolean).slice(1); // drop 'api'
  const method = req.method ?? 'GET';

  void (async () => {
    try {
      // GET /api/events
      if (method === 'GET' && segments[0] === 'events' && segments.length === 1) {
        return streamEvents(res, bus, req);
      }

      // GET /api/inboxes
      if (method === 'GET' && segments[0] === 'inboxes' && segments.length === 1) {
        return sendJson(res, 200, store.listInboxes());
      }

      // PATCH /api/inboxes/:id
      if (method === 'PATCH' && segments[0] === 'inboxes' && segments.length === 2) {
        const body = (await readJsonBody(req)) as { name?: unknown };
        if (typeof body.name !== 'string' || body.name.trim() === '') {
          return sendJson(res, 400, { error: 'name must be a non-empty string' });
        }
        const inbox = store.renameInbox(Number(segments[1]), body.name.trim());
        return inbox ? sendJson(res, 200, inbox) : notFound(res);
      }

      // GET /api/inboxes/:id/messages
      if (method === 'GET' && segments[0] === 'inboxes' && segments[2] === 'messages' && segments.length === 3) {
        const inboxId = Number(segments[1]);
        if (!store.getInbox(inboxId)) return notFound(res);
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200);
        const offset = Number(url.searchParams.get('offset') ?? 0) || 0;
        const q = url.searchParams.get('q') ?? undefined;
        return sendJson(res, 200, store.listMessages(inboxId, { q, limit, offset }));
      }

      // DELETE /api/inboxes/:id/messages
      if (method === 'DELETE' && segments[0] === 'inboxes' && segments[2] === 'messages' && segments.length === 3) {
        const inboxId = Number(segments[1]);
        if (!store.getInbox(inboxId)) return notFound(res);
        store.clearInbox(inboxId);
        bus.emit({ type: 'messages.cleared', inboxId });
        return res.writeHead(204).end();
      }

      // GET /api/messages/:id/raw
      if (method === 'GET' && segments[0] === 'messages' && segments[2] === 'raw' && segments.length === 3) {
        const message = store.getMessage(Number(segments[1]));
        if (!message) return notFound(res);
        res.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': `attachment; filename="message-${message.id}.eml"`,
        });
        return res.end(message.raw);
      }

      // GET /api/messages/:id
      if (method === 'GET' && segments[0] === 'messages' && segments.length === 2) {
        const message = store.getMessage(Number(segments[1]));
        return message ? sendJson(res, 200, message) : notFound(res);
      }

      // DELETE /api/messages/:id
      if (method === 'DELETE' && segments[0] === 'messages' && segments.length === 2) {
        const deleted = store.deleteMessage(Number(segments[1]));
        if (!deleted) return notFound(res);
        bus.emit({ type: 'message.deleted', id: Number(segments[1]), inboxId: deleted.inboxId });
        return res.writeHead(204).end();
      }

      notFound(res);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
      else res.end();
    }
  })();

  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace packages/server`
Expected: PASS — 46 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api.ts packages/server/src/api.test.ts
git commit -m "feat: add JSON API and SSE event stream"
```

---

### Task 8: HTTP server, entrypoint, and bin

Composes everything into a running process: static file serving, wiring SMTP saves onto the bus, console output, and clean failure when a port is taken.

**Files:**
- Create: `packages/server/src/web.ts`
- Create: `packages/server/src/main.ts`
- Create: `packages/server/bin/mailtraxx.js`
- Test: `packages/server/src/web.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1), `SqliteStore` (Tasks 2–3), `startSmtpServer` (Task 5), `EventBus` (Task 6), `handleApi` (Task 7).
- Produces: `startWebServer(config: Config, store: SqliteStore, bus: EventBus, uiRoot: string): Promise<WebHandle>` where `interface WebHandle { port: number; close(): Promise<void> }`, and `runMailtraxx(argv: string[]): Promise<{ smtp: SmtpHandle; web: WebHandle; store: SqliteStore }>` from `main.ts`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/web.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebServer } from './web.ts';
import { SqliteStore } from './store.ts';
import { EventBus } from './bus.ts';
import { parseConfig } from './config.ts';

async function harness() {
  const uiRoot = await mkdtemp(join(tmpdir(), 'mailtraxx-ui-'));
  await writeFile(join(uiRoot, 'index.html'), '<title>mailtraxx</title>');
  await mkdir(join(uiRoot, 'assets'), { recursive: true });
  await writeFile(join(uiRoot, 'assets', 'app.js'), 'console.log(1)');

  const store = new SqliteStore(':memory:', 500);
  const bus = new EventBus();
  const web = await startWebServer(parseConfig(['--http-port', '0']), store, bus, uiRoot);
  return {
    base: `http://127.0.0.1:${web.port}`,
    store,
    async close() {
      await web.close();
      store.close();
      await rm(uiRoot, { recursive: true, force: true });
    },
  };
}

test('serves the SPA index at the root', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await res.text(), /mailtraxx/);
  await h.close();
});

test('serves static assets with the right content type', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/assets/app.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
  await h.close();
});

test('falls back to index.html for SPA deep links', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/inbox/1/message/2`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /mailtraxx/);
  await h.close();
});

test('still routes /api requests to the API', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/api/inboxes`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
  await h.close();
});

test('refuses to serve files outside the UI root', async () => {
  const h = await harness();
  const res = await fetch(`${h.base}/../../../etc/passwd`, { redirect: 'manual' });
  assert.notEqual(res.status, 200);
  await h.close();
});

test('reports a busy port instead of crashing anonymously', async () => {
  const store = new SqliteStore(':memory:', 500);
  const bus = new EventBus();
  const first = await startWebServer(parseConfig(['--http-port', '0']), store, bus, tmpdir());
  await assert.rejects(
    startWebServer(parseConfig(['--http-port', String(first.port)]), store, bus, tmpdir()),
    /already in use/,
  );
  await first.close();
  store.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace packages/server`
Expected: FAIL — cannot find module `./web.ts`.

- [ ] **Step 3: Write the web server**

`packages/server/src/web.ts`:

```ts
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Config } from './config.ts';
import type { SqliteStore } from './store.ts';
import type { EventBus } from './bus.ts';
import { handleApi } from './api.ts';

export interface WebHandle {
  port: number;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

async function serveFile(path: string, res: import('node:http').ServerResponse): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
      'content-length': info.size,
    });
    createReadStream(path).pipe(res);
    return true;
  } catch {
    return false;
  }
}

export async function startWebServer(
  config: Config,
  store: SqliteStore,
  bus: EventBus,
  uiRoot: string,
): Promise<WebHandle> {
  const root = resolve(uiRoot);

  const server = createServer((req, res) => {
    if (handleApi(req, res, store, bus)) return;

    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const candidate = resolve(join(root, normalize(pathname)));

      // Path traversal guard: the resolved path must stay under the UI root.
      if (candidate !== root && !candidate.startsWith(root + sep)) {
        res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
        return;
      }

      if (pathname !== '/' && (await serveFile(candidate, res))) return;
      // SPA fallback: unknown paths are client-side routes.
      if (await serveFile(join(root, 'index.html'), res)) return;

      res.writeHead(404, { 'content-type': 'text/plain' }).end('mailtraxx UI is not built yet');
    })();
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${config.httpPort} is already in use. Start mailtraxx with --http-port <n> to pick another.`)
          : err,
      );
    });
    server.listen(config.httpPort, '127.0.0.1', () => resolvePromise());
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
```

- [ ] **Step 4: Run the web tests to verify they pass**

Run: `npm test --workspace packages/server`
Expected: PASS — 52 tests total.

- [ ] **Step 5: Write the entrypoint**

`packages/server/src/main.ts`:

```ts
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
```

- [ ] **Step 6: Write the bin wrapper**

`packages/server/bin/mailtraxx.js`. It re-execs Node with `--no-warnings=ExperimentalWarning` so the `node:sqlite` experimental notice doesn't clutter startup output.

```js
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
```

- [ ] **Step 7: Verify the process actually starts and captures mail end to end**

Run, from the repo root:

```bash
node packages/server/bin/mailtraxx.js --smtp-port 3025 --http-port 3080 --db /tmp/mailtraxx-smoke.db &
sleep 1
node -e "
const nodemailer = require('nodemailer');
nodemailer.createTransport({host:'127.0.0.1',port:3025,secure:false,auth:{user:'cfp',pass:'x'}})
  .sendMail({from:'a@b.c',to:'d@e.f',subject:'Smoke test',html:'<b>hi</b>'})
  .then(() => console.log('sent'));
"
curl -s http://127.0.0.1:3080/api/inboxes
```

Expected: the banner prints, a `←` line appears for the captured mail, and `curl` returns one inbox named `cfp` with `messageCount: 1`. Then stop the background process and `rm /tmp/mailtraxx-smoke.db*`.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/web.ts packages/server/src/main.ts packages/server/src/web.test.ts packages/server/bin
git commit -m "feat: serve the SPA, compose the process, and add the CLI entrypoint"
```

---

### Task 9: Angular 22 scaffold and data services

**Files:**
- Create: `packages/ui/**` (via `ng new`)
- Create: `packages/ui/src/app/models.ts`
- Create: `packages/ui/src/app/mailtraxx-api.ts`
- Create: `packages/ui/src/app/live-feed.ts`
- Create: `packages/ui/proxy.conf.json`
- Modify: `packages/ui/angular.json` (dev-server proxy)
- Test: `packages/ui/src/app/live-feed.spec.ts`

**Interfaces:**
- Consumes: the HTTP API from Task 7.
- Produces:
  - `models.ts` — TypeScript mirrors of the server types: `Inbox`, `MessageSummary`, `Message`, `AttachmentMeta`, `MailtraxxEvent`. Field names match `packages/server/src/types.ts` exactly.
  - `MailtraxxApi` service — `renameInbox(id, name): Promise<Inbox>`, `deleteMessage(id): Promise<void>`, `clearInbox(id): Promise<void>`, `rawUrl(id): string`.
  - `LiveFeed` service — `lastEvent: Signal<MailtraxxEvent | null>`, `connected: Signal<boolean>`.

- [ ] **Step 1: Scaffold the Angular app**

Run from the repo root:

```bash
npx @angular/cli@22 new ui --directory packages/ui --style=css --ssr=false --zoneless --skip-git --package-manager=npm --defaults
npm install
```

Expected: `packages/ui` exists with `@angular/core` 22.x in its `package.json`.

- [ ] **Step 2: Verify the scaffold builds and its tests run**

Run: `npm run build --workspace packages/ui && npm test --workspace packages/ui -- --watch=false --browsers=ChromeHeadless`
Expected: build succeeds into `packages/ui/dist/ui/browser`; the default spec passes.

- [ ] **Step 3: Add the dev-server proxy**

`packages/ui/proxy.conf.json`:

```json
{
  "/api": { "target": "http://127.0.0.1:1080", "secure": false }
}
```

In `packages/ui/angular.json`, under `projects.ui.architect.serve.options`, add:

```json
"proxyConfig": "proxy.conf.json"
```

- [ ] **Step 4: Write the shared models**

`packages/ui/src/app/models.ts`:

```ts
export interface Inbox {
  id: number;
  smtpUser: string;
  name: string;
  createdAt: string;
  messageCount: number;
  latestReceivedAt: string | null;
}

export interface AttachmentMeta {
  filename: string | null;
  contentType: string | null;
  sizeBytes: number;
}

export interface MessageSummary {
  id: number;
  inboxId: number;
  fromDisplay: string | null;
  toAddrs: string[];
  subject: string | null;
  sizeBytes: number;
  hasHtml: boolean;
  parseError: string | null;
  receivedAt: string;
}

export interface Message extends MessageSummary {
  messageId: string | null;
  fromAddr: string;
  ccAddrs: string[];
  html: string | null;
  text: string | null;
  raw: string;
  headers: Record<string, string>;
  attachments: AttachmentMeta[];
}

export type MailtraxxEvent =
  | { type: 'message.created'; message: MessageSummary }
  | { type: 'inbox.created'; inbox: Inbox }
  | { type: 'message.deleted'; id: number; inboxId: number }
  | { type: 'messages.cleared'; inboxId: number };
```

- [ ] **Step 5: Write the API service**

`packages/ui/src/app/mailtraxx-api.ts`. Reads go through `httpResource` in the components; this service holds the writes.

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Inbox } from './models';

@Injectable({ providedIn: 'root' })
export class MailtraxxApi {
  readonly #http = inject(HttpClient);

  renameInbox(id: number, name: string): Promise<Inbox> {
    return firstValueFrom(this.#http.patch<Inbox>(`/api/inboxes/${id}`, { name }));
  }

  clearInbox(id: number): Promise<void> {
    return firstValueFrom(this.#http.delete<void>(`/api/inboxes/${id}/messages`));
  }

  deleteMessage(id: number): Promise<void> {
    return firstValueFrom(this.#http.delete<void>(`/api/messages/${id}`));
  }

  rawUrl(id: number): string {
    return `/api/messages/${id}/raw`;
  }
}
```

- [ ] **Step 6: Write the failing test for the live feed**

`packages/ui/src/app/live-feed.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { LiveFeed } from './live-feed';

class FakeEventSource {
  static last: FakeEventSource | undefined;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
}

describe('LiveFeed', () => {
  let original: typeof EventSource;

  beforeEach(() => {
    original = window.EventSource;
    (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    (window as unknown as { EventSource: unknown }).EventSource = original;
  });

  it('connects to the events endpoint', () => {
    TestBed.inject(LiveFeed);
    expect(FakeEventSource.last?.url).toBe('/api/events');
  });

  it('exposes the most recent event as a signal', () => {
    const feed = TestBed.inject(LiveFeed);
    expect(feed.lastEvent()).toBeNull();

    FakeEventSource.last!.onmessage!({
      data: JSON.stringify({ type: 'messages.cleared', inboxId: 7 }),
    } as MessageEvent);

    expect(feed.lastEvent()).toEqual({ type: 'messages.cleared', inboxId: 7 });
  });

  it('tracks connection state', () => {
    const feed = TestBed.inject(LiveFeed);
    expect(feed.connected()).toBe(false);
    FakeEventSource.last!.onopen!();
    expect(feed.connected()).toBe(true);
    FakeEventSource.last!.onerror!();
    expect(feed.connected()).toBe(false);
  });

  it('ignores malformed event payloads', () => {
    const feed = TestBed.inject(LiveFeed);
    FakeEventSource.last!.onmessage!({ data: 'not json' } as MessageEvent);
    expect(feed.lastEvent()).toBeNull();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test --workspace packages/ui -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — cannot resolve `./live-feed`.

- [ ] **Step 8: Write the live feed service**

`packages/ui/src/app/live-feed.ts`:

```ts
import { Injectable, signal } from '@angular/core';
import type { MailtraxxEvent } from './models';

const EVENT_TYPES = ['message.created', 'inbox.created', 'message.deleted', 'messages.cleared'] as const;

/**
 * Holds the SSE connection to the server. Components react by reading
 * `lastEvent()` — the signal is the seam between the socket and the UI.
 */
@Injectable({ providedIn: 'root' })
export class LiveFeed {
  readonly #lastEvent = signal<MailtraxxEvent | null>(null);
  readonly #connected = signal(false);

  readonly lastEvent = this.#lastEvent.asReadonly();
  readonly connected = this.#connected.asReadonly();

  constructor() {
    const source = new EventSource('/api/events');
    source.onopen = () => this.#connected.set(true);
    source.onerror = () => this.#connected.set(false);

    const receive = (event: MessageEvent) => {
      try {
        this.#lastEvent.set(JSON.parse(event.data as string) as MailtraxxEvent);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    // The server sends *named* events (`event: message.created`), which browsers
    // deliver to per-type listeners rather than to onmessage. onmessage stays as a
    // fallback for unnamed frames.
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, receive as EventListener);
    }
    source.onmessage = receive;
  }
}
```

- [ ] **Step 9: Register `provideHttpClient` in the app config**

In `packages/ui/src/app/app.config.ts`, add `provideHttpClient()` from `@angular/common/http` to the `providers` array, keeping the existing `provideZonelessChangeDetection()` and router providers.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm test --workspace packages/ui -- --watch=false --browsers=ChromeHeadless`
Expected: PASS — 4 LiveFeed specs.

- [ ] **Step 11: Commit**

```bash
git add packages/ui package.json package-lock.json
git commit -m "feat: scaffold Angular 22 UI with API and live-feed services"
```

---

### Task 10: Inbox list and message list

**Files:**
- Create: `packages/ui/src/app/inbox-list.ts`
- Create: `packages/ui/src/app/message-list.ts`
- Modify: `packages/ui/src/app/app.ts` (three-pane shell)
- Modify: `packages/ui/src/app/app.html`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/src/app/message-list.spec.ts`

**Interfaces:**
- Consumes: `Inbox`, `MessageSummary`, `MailtraxxEvent` (Task 9 `models.ts`); `MailtraxxApi`, `LiveFeed` (Task 9).
- Produces:
  - `InboxList` component, selector `mtx-inbox-list`. Inputs: `selectedId = input<number | null>(null)`. Outputs: `selected = output<Inbox>()`.
  - `MessageList` component, selector `mtx-message-list`. Inputs: `inboxId = input.required<number>()`, `selectedId = input<number | null>(null)`. Outputs: `selected = output<MessageSummary>()`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/app/message-list.spec.ts`:

```ts
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MessageList } from './message-list';
import type { MessageSummary } from './models';

function summary(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: 1,
    inboxId: 1,
    fromDisplay: 'Devoxx CFP <no_reply+dev@cfp.dev>',
    toAddrs: ['speaker@example.com'],
    subject: 'Your talk was accepted',
    sizeBytes: 42,
    hasHtml: true,
    parseError: null,
    receivedAt: '2026-08-12T10:00:00.000Z',
    ...overrides,
  };
}

describe('MessageList', () => {
  let fixture: ComponentFixture<MessageList>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageList],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(MessageList);
    fixture.componentRef.setInput('inboxId', 1);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('loads messages for the selected inbox', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([summary()]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your talk was accepted');
    expect(fixture.nativeElement.textContent).toContain('speaker@example.com');
  });

  it('shows a placeholder when the inbox is empty', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No messages yet');
  });

  it('labels a message with no subject', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([summary({ subject: null })]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('(no subject)');
  });

  it('flags a message that failed to parse', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([summary({ parseError: 'bad MIME' })]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.parse-error')).toBeTruthy();
  });

  it('refetches when the search term changes', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([summary()]);
    await fixture.whenStable();

    fixture.componentInstance.search.set('accepted');
    fixture.detectChanges();
    await fixture.whenStable();

    http.expectOne('/api/inboxes/1/messages?q=accepted').flush([summary()]);
  });

  it('emits the message the user clicks', async () => {
    http.expectOne('/api/inboxes/1/messages?q=').flush([summary()]);
    await fixture.whenStable();
    fixture.detectChanges();

    let emitted: MessageSummary | undefined;
    fixture.componentInstance.selected.subscribe((m) => (emitted = m));
    fixture.nativeElement.querySelector('.message-row').click();
    expect(emitted?.id).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace packages/ui -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — cannot resolve `./message-list`.

- [ ] **Step 3: Write the message list component**

`packages/ui/src/app/message-list.ts`:

```ts
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { LiveFeed } from './live-feed';
import type { MessageSummary } from './models';

@Component({
  selector: 'mtx-message-list',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="pane-header">
      <input
        type="search"
        class="search"
        placeholder="Search subject, sender, recipient"
        [value]="search()"
        (input)="search.set($any($event.target).value)"
      />
    </header>

    @if (messages.hasValue()) {
      @if (messages.value().length === 0) {
        <p class="empty">No messages yet. Send one from your app and it will appear here.</p>
      } @else {
        <ul class="message-rows">
          @for (message of messages.value(); track message.id) {
            <li
              class="message-row"
              [class.active]="message.id === selectedId()"
              (click)="selected.emit(message)"
            >
              <div class="row-top">
                <span class="subject">{{ message.subject ?? '(no subject)' }}</span>
                <time>{{ message.receivedAt | date: 'HH:mm:ss' }}</time>
              </div>
              <div class="row-bottom">
                <span class="to">{{ message.toAddrs.join(', ') }}</span>
                @if (message.parseError) {
                  <span class="parse-error" title="{{ message.parseError }}">parse failed</span>
                }
              </div>
            </li>
          }
        </ul>
      }
    } @else if (messages.error()) {
      <p class="empty">Could not load messages.</p>
    } @else {
      <p class="empty">Loading…</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); }
    .pane-header { padding: 0.75rem; border-bottom: 1px solid var(--line); }
    .search { width: 100%; padding: 0.5rem 0.65rem; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
    .message-rows { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
    .message-row { padding: 0.7rem 0.85rem; border-bottom: 1px solid var(--line); cursor: pointer; }
    .message-row:hover { background: var(--hover); }
    .message-row.active { background: var(--accent-soft); }
    .row-top { display: flex; justify-content: space-between; gap: 0.5rem; }
    .subject { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    time { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.85em; }
    .row-bottom { display: flex; justify-content: space-between; color: var(--muted); font-size: 0.85em; }
    .parse-error { color: var(--warn); }
    .empty { padding: 1.5rem 0.85rem; color: var(--muted); }
  `,
})
export class MessageList {
  readonly inboxId = input.required<number>();
  readonly selectedId = input<number | null>(null);
  readonly selected = output<MessageSummary>();

  readonly search = signal('');
  readonly #feed = inject(LiveFeed);

  readonly messages = httpResource<MessageSummary[]>(
    () => `/api/inboxes/${this.inboxId()}/messages?q=${encodeURIComponent(this.search())}`,
  );

  constructor() {
    // Any server-side change to this inbox refetches the list.
    effect(() => {
      const event = this.#feed.lastEvent();
      if (!event) return;
      const affected =
        event.type === 'message.created' ? event.message.inboxId :
        event.type === 'message.deleted' ? event.inboxId :
        event.type === 'messages.cleared' ? event.inboxId : null;
      if (affected === this.inboxId()) this.messages.reload();
    });
  }
}
```

- [ ] **Step 4: Run the message list tests to verify they pass**

Run: `npm test --workspace packages/ui -- --watch=false --browsers=ChromeHeadless`
Expected: PASS — 6 MessageList specs plus the 4 from Task 9.

- [ ] **Step 5: Write the inbox list component**

`packages/ui/src/app/inbox-list.ts`:

```ts
import { ChangeDetectionStrategy, Component, effect, inject, input, output } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { LiveFeed } from './live-feed';
import { MailtraxxApi } from './mailtraxx-api';
import type { Inbox } from './models';

@Component({
  selector: 'mtx-inbox-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="pane-header">
      <h1>mailtraxx</h1>
      <span class="status" [class.live]="feed.connected()" [title]="feed.connected() ? 'Live' : 'Disconnected'"></span>
    </header>

    @if (inboxes.hasValue()) {
      <ul class="inbox-rows">
        @for (inbox of inboxes.value(); track inbox.id) {
          <li class="inbox-row" [class.active]="inbox.id === selectedId()" (click)="selected.emit(inbox)">
            <span class="name" (dblclick)="rename(inbox)" title="Double-click to rename">{{ inbox.name }}</span>
            <span class="count">{{ inbox.messageCount }}</span>
            <button type="button" class="clear" (click)="clear($event, inbox)" title="Clear inbox">Clear</button>
          </li>
        } @empty {
          <li class="empty">No inboxes yet. Point an app at SMTP port 2525.</li>
        }
      </ul>
    } @else {
      <p class="empty">Loading…</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; background: var(--sidebar); border-right: 1px solid var(--line); }
    .pane-header { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 0.85rem; border-bottom: 1px solid var(--line); }
    h1 { font-size: 1rem; margin: 0; letter-spacing: 0.02em; }
    .status { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
    .status.live { background: var(--ok); }
    .inbox-rows { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
    .inbox-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.85rem; cursor: pointer; }
    .inbox-row:hover { background: var(--hover); }
    .inbox-row.active { background: var(--accent-soft); }
    .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.85em; }
    .clear { opacity: 0; border: 0; background: none; color: var(--muted); cursor: pointer; font: inherit; font-size: 0.8em; }
    .inbox-row:hover .clear { opacity: 1; }
    .empty { padding: 1rem 0.85rem; color: var(--muted); font-size: 0.9em; }
  `,
})
export class InboxList {
  readonly selectedId = input<number | null>(null);
  readonly selected = output<Inbox>();

  readonly feed = inject(LiveFeed);
  readonly #api = inject(MailtraxxApi);
  readonly inboxes = httpResource<Inbox[]>(() => '/api/inboxes');

  constructor() {
    effect(() => {
      if (this.feed.lastEvent()) this.inboxes.reload();
    });
  }

  async rename(inbox: Inbox): Promise<void> {
    const name = prompt('Rename inbox', inbox.name);
    if (!name?.trim()) return;
    await this.#api.renameInbox(inbox.id, name.trim());
    this.inboxes.reload();
  }

  async clear(event: Event, inbox: Inbox): Promise<void> {
    event.stopPropagation();
    if (!confirm(`Delete all ${inbox.messageCount} messages in ${inbox.name}?`)) return;
    await this.#api.clearInbox(inbox.id);
    this.inboxes.reload();
  }
}
```

- [ ] **Step 6: Wire the three-pane shell**

Replace `packages/ui/src/app/app.ts`:

```ts
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { InboxList } from './inbox-list';
import { MessageList } from './message-list';
import type { Inbox, MessageSummary } from './models';

@Component({
  selector: 'app-root',
  imports: [InboxList, MessageList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <mtx-inbox-list [selectedId]="inbox()?.id ?? null" (selected)="selectInbox($event)" />

      @if (inbox(); as current) {
        <mtx-message-list
          [inboxId]="current.id"
          [selectedId]="message()?.id ?? null"
          (selected)="message.set($event)"
        />
      } @else {
        <div class="placeholder">Select an inbox</div>
      }

      <div class="placeholder">Select a message</div>
    </div>
  `,
  styles: `
    .shell { display: grid; grid-template-columns: 15rem 22rem 1fr; height: 100dvh; }
    .placeholder { display: grid; place-items: center; color: var(--muted); }
  `,
})
export class App {
  readonly inbox = signal<Inbox | null>(null);
  readonly message = signal<MessageSummary | null>(null);

  selectInbox(inbox: Inbox): void {
    this.inbox.set(inbox);
    this.message.set(null);
  }
}
```

Delete `packages/ui/src/app/app.html` and `app.css` if `ng new` created them, and remove the corresponding `templateUrl`/`styleUrl` references. Update `packages/ui/src/app/app.spec.ts` to drop assertions about the default scaffold content — replace its single test with:

```ts
  it('creates the shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
```

- [ ] **Step 7: Add the design tokens**

Append to `packages/ui/src/styles.css`:

```css
:root {
  --bg: #ffffff;
  --sidebar: #f7f7f8;
  --line: #e3e3e6;
  --hover: #f0f0f2;
  --accent-soft: #e6efff;
  --text: #1a1a1c;
  --muted: #74747c;
  --ok: #2e9e5b;
  --warn: #c2410c;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17171a;
    --sidebar: #1c1c20;
    --line: #2c2c31;
    --hover: #232328;
    --accent-soft: #1e2b45;
    --text: #ececf0;
    --muted: #8c8c96;
    --ok: #4ade80;
    --warn: #fb923c;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
```

- [ ] **Step 8: Run the tests and build**

Run: `npm test --workspace packages/ui -- --watch=false --browsers=ChromeHeadless && npm run build --workspace packages/ui`
Expected: PASS, and a successful build.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src
git commit -m "feat: add inbox list, message list, and three-pane shell"
```

---

### Task 11: Message viewer and HTML preview

**Files:**
- Create: `packages/ui/src/app/message-viewer.ts`
- Create: `packages/ui/src/app/html-preview.ts`
- Modify: `packages/ui/src/app/app.ts` (replace the right-hand placeholder)
- Test: `packages/ui/src/app/html-preview.spec.ts`
- Test: `packages/ui/src/app/message-viewer.spec.ts`

**Interfaces:**
- Consumes: `Message`, `MessageSummary` (Task 9 `models.ts`); `MailtraxxApi`, `LiveFeed` (Task 9).
- Produces:
  - `HtmlPreview` component, selector `mtx-html-preview`. Inputs: `html = input.required<string>()`, `allowRemote = input(false)`.
  - `MessageViewer` component, selector `mtx-message-viewer`. Inputs: `messageId = input.required<number>()`. Outputs: `deleted = output<number>()`.

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/app/html-preview.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { HtmlPreview } from './html-preview';

describe('HtmlPreview', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HtmlPreview] }).compileComponents();
  });

  function render(html: string, allowRemote = false) {
    const fixture = TestBed.createComponent(HtmlPreview);
    fixture.componentRef.setInput('html', html);
    fixture.componentRef.setInput('allowRemote', allowRemote);
    fixture.detectChanges();
    return fixture;
  }

  it('renders into a sandboxed iframe that cannot run scripts', () => {
    const iframe = render('<h1>Hi</h1>').nativeElement.querySelector('iframe') as HTMLIFrameElement;
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(iframe).toBeTruthy();
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('injects a CSP that blocks remote content by default', () => {
    const iframe = render('<img src="https://tracker.example/p.gif">').nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain("img-src data:");
    expect(doc).toContain('<img src="https://tracker.example/p.gif">');
  });

  it('permits remote images once the user opts in', () => {
    const iframe = render('<img src="https://tracker.example/p.gif">', true).nativeElement.querySelector('iframe');
    const doc = iframe.getAttribute('srcdoc') as string;
    expect(doc).toContain('img-src data: https: http:');
  });
});
```

`packages/ui/src/app/message-viewer.spec.ts`:

```ts
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MessageViewer } from './message-viewer';
import type { Message } from './models';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    inboxId: 1,
    messageId: '<abc@cfp.dev>',
    fromAddr: 'no_reply+dev@cfp.dev',
    fromDisplay: 'Devoxx CFP <no_reply+dev@cfp.dev>',
    toAddrs: ['speaker@example.com'],
    ccAddrs: [],
    subject: 'Your talk was accepted',
    html: '<h1>Accepted</h1>',
    text: 'Accepted',
    raw: 'Subject: Your talk was accepted\r\n\r\nAccepted',
    headers: { subject: 'Your talk was accepted', 'x-custom': 'value' },
    sizeBytes: 42,
    hasHtml: true,
    parseError: null,
    attachments: [],
    receivedAt: '2026-08-12T10:00:00.000Z',
    ...overrides,
  };
}

describe('MessageViewer', () => {
  let fixture: ComponentFixture<MessageViewer>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageViewer],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MessageViewer);
    fixture.componentRef.setInput('messageId', 1);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function load(m: Message = message()) {
    http.expectOne('/api/messages/1').flush(m);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the header summary', async () => {
    await load();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Your talk was accepted');
    expect(text).toContain('no_reply+dev@cfp.dev');
    expect(text).toContain('speaker@example.com');
  });

  it('defaults to the HTML tab and can switch to Text, Raw, and Headers', async () => {
    await load();
    expect(fixture.componentInstance.tab()).toBe('html');
    expect(fixture.nativeElement.querySelector('mtx-html-preview')).toBeTruthy();

    fixture.componentInstance.tab.set('raw');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Subject: Your talk was accepted');

    fixture.componentInstance.tab.set('headers');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('x-custom');
  });

  it('opens on the Raw tab when the message failed to parse', async () => {
    await load(message({ parseError: 'bad MIME', html: null, text: null }));
    expect(fixture.componentInstance.tab()).toBe('raw');
  });

  it('lists attachment metadata without offering a download', async () => {
    await load(message({ attachments: [{ filename: 'slides.pdf', contentType: 'application/pdf', sizeBytes: 2048 }] }));
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('slides.pdf');
    expect(text).toContain('2.0 KB');
  });

  it('emits after deleting', async () => {
    await load();
    spyOn(window, 'confirm').and.returnValue(true);
    let emitted: number | undefined;
    fixture.componentInstance.deleted.subscribe((id) => (emitted = id));

    void fixture.componentInstance.remove();
    http.expectOne({ url: '/api/messages/1', method: 'DELETE' }).flush(null);
    await fixture.whenStable();
    expect(emitted).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace packages/ui -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — cannot resolve `./html-preview` and `./message-viewer`.

- [ ] **Step 3: Write the HTML preview**

`packages/ui/src/app/html-preview.ts`. Captured mail is untrusted, so it renders inside `srcdoc` with scripts and same-origin access withheld and a CSP that blocks remote subresources until the user asks for them.

```ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { inject } from '@angular/core';

@Component({
  selector: 'mtx-html-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<iframe sandbox="" [srcdoc]="document()" title="Email preview"></iframe>`,
  styles: `
    :host { display: block; height: 100%; }
    iframe { width: 100%; height: 100%; border: 0; background: #fff; }
  `,
})
export class HtmlPreview {
  readonly html = input.required<string>();
  readonly allowRemote = input(false);

  readonly #sanitizer = inject(DomSanitizer);

  readonly document = computed<SafeHtml>(() => {
    const imgSrc = this.allowRemote() ? 'data: https: http:' : 'data:';
    const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:`;
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${this.html()}</body></html>`;
    // Trusted only in the sense that the iframe sandbox, not Angular, is the boundary.
    return this.#sanitizer.bypassSecurityTrustHtml(doc);
  });
}
```

Note on the CSP: `default-src 'none'` blocks scripts, frames, and network fetches; the `sandbox=""` attribute is the real boundary and the CSP is the second layer. `style-src 'unsafe-inline'` is required — nearly every HTML email uses inline styles.

- [ ] **Step 4: Write the message viewer**

`packages/ui/src/app/message-viewer.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { HtmlPreview } from './html-preview';
import { MailtraxxApi } from './mailtraxx-api';
import type { Message } from './models';

type Tab = 'html' | 'text' | 'raw' | 'headers';

@Component({
  selector: 'mtx-message-viewer',
  imports: [HtmlPreview, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message.hasValue()) {
      @let m = message.value();
      <header class="summary">
        <h2>{{ m.subject ?? '(no subject)' }}</h2>
        <dl>
          <dt>From</dt><dd>{{ m.fromDisplay ?? m.fromAddr }}</dd>
          <dt>To</dt><dd>{{ m.toAddrs.join(', ') }}</dd>
          @if (m.ccAddrs.length) { <dt>Cc</dt><dd>{{ m.ccAddrs.join(', ') }}</dd> }
          <dt>Received</dt><dd>{{ m.receivedAt | date: 'medium' }} · {{ size(m.sizeBytes) }}</dd>
        </dl>

        @if (m.parseError) {
          <p class="parse-error">This message could not be parsed: {{ m.parseError }}</p>
        }

        @if (m.attachments.length) {
          <ul class="attachments">
            @for (a of m.attachments; track $index) {
              <li>{{ a.filename ?? '(unnamed)' }} · {{ a.contentType ?? 'unknown type' }} · {{ size(a.sizeBytes) }}</li>
            }
          </ul>
        }

        <nav class="tabs">
          @for (t of tabs; track t) {
            <button type="button" [class.active]="tab() === t" (click)="tab.set(t)">{{ t | uppercase }}</button>
          }
          <span class="spacer"></span>
          @if (tab() === 'html') {
            <label class="remote">
              <input type="checkbox" [checked]="allowRemote()" (change)="allowRemote.set($any($event.target).checked)" />
              Load remote content
            </label>
          }
          <a [href]="rawUrl()" download>Download .eml</a>
          <button type="button" class="delete" (click)="remove()">Delete</button>
        </nav>
      </header>

      <section class="body">
        @switch (tab()) {
          @case ('html') {
            @if (m.html) {
              <mtx-html-preview [html]="m.html" [allowRemote]="allowRemote()" />
            } @else {
              <p class="empty">This message has no HTML part.</p>
            }
          }
          @case ('text') {
            @if (m.text) { <pre>{{ m.text }}</pre> } @else { <p class="empty">This message has no plain-text part.</p> }
          }
          @case ('raw') { <pre>{{ m.raw }}</pre> }
          @case ('headers') {
            <dl class="headers">
              @for (entry of headerEntries(); track entry[0]) {
                <dt>{{ entry[0] }}</dt><dd>{{ entry[1] }}</dd>
              }
            </dl>
          }
        }
      </section>
    } @else if (message.error()) {
      <p class="empty">Could not load this message.</p>
    } @else {
      <p class="empty">Loading…</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    .summary { padding: 0.85rem; border-bottom: 1px solid var(--line); }
    h2 { margin: 0 0 0.5rem; font-size: 1.05rem; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.75rem; margin: 0; font-size: 0.9em; }
    dt { color: var(--muted); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .parse-error { color: var(--warn); font-size: 0.9em; }
    .attachments { margin: 0.5rem 0 0; padding-left: 1.1rem; color: var(--muted); font-size: 0.85em; }
    .tabs { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.85rem; }
    .tabs button { border: 1px solid var(--line); background: none; color: inherit; border-radius: 5px; padding: 0.25rem 0.6rem; font: inherit; font-size: 0.8em; cursor: pointer; }
    .tabs button.active { background: var(--accent-soft); }
    .tabs .spacer { flex: 1; }
    .tabs a { color: var(--muted); font-size: 0.8em; }
    .remote { color: var(--muted); font-size: 0.8em; display: flex; align-items: center; gap: 0.25rem; }
    .body { flex: 1; min-height: 0; overflow: auto; }
    pre { margin: 0; padding: 0.85rem; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.85em; }
    .headers { padding: 0.85rem; font-size: 0.85em; }
    .empty { padding: 1.5rem 0.85rem; color: var(--muted); }
  `,
})
export class MessageViewer {
  readonly messageId = input.required<number>();
  readonly deleted = output<number>();

  readonly tabs: Tab[] = ['html', 'text', 'raw', 'headers'];
  readonly tab = signal<Tab>('html');
  readonly allowRemote = signal(false);

  readonly #api = inject(MailtraxxApi);
  readonly message = httpResource<Message>(() => `/api/messages/${this.messageId()}`);

  readonly headerEntries = computed(() =>
    this.message.hasValue() ? Object.entries(this.message.value().headers) : [],
  );
  readonly rawUrl = computed(() => this.#api.rawUrl(this.messageId()));

  constructor() {
    // A new message resets the view; an unparseable one opens on Raw, the only tab with content.
    effect(() => {
      if (!this.message.hasValue()) return;
      this.allowRemote.set(false);
      this.tab.set(this.message.value().parseError ? 'raw' : 'html');
    });
  }

  size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async remove(): Promise<void> {
    if (!confirm('Delete this message?')) return;
    await this.#api.deleteMessage(this.messageId());
    this.deleted.emit(this.messageId());
  }
}
```

Add `UpperCasePipe` to the component's `imports` array alongside `DatePipe` (the template uses the `uppercase` pipe), importing it from `@angular/common`.

- [ ] **Step 5: Wire the viewer into the shell**

In `packages/ui/src/app/app.ts`, add `MessageViewer` to `imports` and replace the trailing `<div class="placeholder">Select a message</div>` with:

```html
      @if (message(); as selected) {
        <mtx-message-viewer [messageId]="selected.id" (deleted)="message.set(null)" />
      } @else {
        <div class="placeholder">Select a message</div>
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace packages/ui -- --watch=false --browsers=ChromeHeadless`
Expected: PASS — 4 LiveFeed + 6 MessageList + 3 HtmlPreview + 5 MessageViewer specs.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src
git commit -m "feat: add message viewer with sandboxed HTML preview"
```

---

### Task 12: Build wiring, README, and the callforpapers acceptance run

The end-to-end proof: real mail from the real app showing up in the real UI.

**Files:**
- Modify: `package.json` (root scripts)
- Create: `README.md`
- Modify: `/Users/stephan/projects/callforpapers/src/main/resources/application-dev.yml`

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: no new code interfaces — this task produces a runnable, documented product.

- [ ] **Step 1: Add the root scripts**

Replace the `scripts` block in the root `package.json`:

```json
  "scripts": {
    "build": "npm run build --workspace packages/ui",
    "start": "npm run build && node --no-warnings=ExperimentalWarning packages/server/src/main.ts",
    "dev:server": "node --no-warnings=ExperimentalWarning --watch packages/server/src/main.ts",
    "dev:ui": "npm start --workspace packages/ui",
    "test": "npm run test --workspace packages/server && npm test --workspace packages/ui -- --watch=false --browsers=ChromeHeadless"
  }
```

- [ ] **Step 2: Verify the full build and test run**

Run: `npm run build && npm test`
Expected: the Angular bundle lands in `packages/ui/dist/ui/browser`, and all server and UI tests pass.

- [ ] **Step 3: Start mailtraxx and confirm the UI loads**

Run: `npm start`
Expected: the banner prints `mailtraxx  SMTP 127.0.0.1:2525   UI http://localhost:1080`. Open `http://localhost:1080` — the shell renders with "No inboxes yet."

Leave it running for the next steps.

- [ ] **Step 4: Send a test message and watch it arrive live**

With the UI open in the browser, run in another terminal:

```bash
node -e "
const nodemailer = require('/Users/stephan/IdeaProjects/mailtraxx/node_modules/nodemailer');
nodemailer.createTransport({host:'127.0.0.1',port:2525,secure:false,auth:{user:'240f00ce858a00',pass:'b6cba990e80601'}})
  .sendMail({from:'Devoxx CFP <no_reply+dev@cfp.dev>',to:'speaker@example.com',subject:'Your talk was accepted',
             html:'<h1>Accepted</h1><p>See you at Devoxx.</p><img src=\"https://tracker.example/p.gif\">',
             text:'Accepted'})
  .then(() => console.log('sent'));
"
```

Expected, without touching the browser: the inbox `240f00ce858a00` appears in the sidebar, the message appears in the list, and clicking it renders the HTML with the remote tracking image blocked until the "Load remote content" box is ticked. The terminal shows the `←` capture line.

- [ ] **Step 5: Point callforpapers at mailtraxx**

callforpapers loads its untracked `.env` into the environment via mise (`mise.toml`: `_.file = ["{{ config_root }}/.env"]`, and `.gitignore:12` ignores `/.env`). Spring Boot's relaxed binding maps `SPRING_MAIL_HOST` onto `spring.mail.host`, so a single line in that local file overrides the dev profile without touching tracked config that other developers share.

Append to `/Users/stephan/projects/callforpapers/.env`:

```bash
# Capture dev mail locally with mailtraxx instead of the shared mailtrap.io sandbox
SPRING_MAIL_HOST=localhost
```

`port: 2525`, `username`, `password`, and the `mail.smtp.*` properties in `application-dev.yml` stay exactly as they are — mailtraxx accepts those credentials and uses the username as the inbox name.

Verify the override took effect: start the app and confirm the log or `/actuator/env` reports `spring.mail.host = localhost`. If it did not, fall back to editing `src/main/resources/application-dev.yml` (`host: smtp.mailtrap.io` → `localhost`) and be aware that this change is tracked and would redirect teammates' dev mail too.

- [ ] **Step 6: Run the acceptance test**

Start callforpapers in its dev profile with mail sending enabled (`CFP_MAIL_ENABLED=true`, and `spring.mail.enabled: true` — it defaults to `false` in `application.yml`). Trigger an email the app really sends, such as a speaker notification.

Expected: the message appears in the `240f00ce858a00` inbox with the correct subject, recipient, and rendered HTML. If Jakarta Mail reports an authentication failure, confirm `allowInsecureAuth: true` and `disabledCommands: ['STARTTLS']` are both set in `packages/server/src/smtp.ts` — that pair is what makes opportunistic STARTTLS fall back to plaintext AUTH.

- [ ] **Step 7: Write the README**

`README.md`:

````markdown
# mailtraxx

A local stand-in for [Mailtrap](https://mailtrap.io). It runs a fake SMTP server on your machine,
catches every email your apps send, and shows them in a browser — so you can check that mail is
generated correctly without delivering it to real people.

## Requirements

Node 22.18 or newer.

## Running

```bash
npm install
npm run build   # builds the Angular UI
npm start
```

```
mailtraxx  SMTP 127.0.0.1:2525   UI http://localhost:1080
```

Point any app's SMTP settings at `localhost:2525`. Any username and password are accepted — the
**username picks the inbox**, created on first use. Unauthenticated mail lands in `default`.

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--smtp-port <n>` | 2525 | SMTP listen port |
| `--http-port <n>` | 1080 | Web UI and API port |
| `--db <path>` | `~/.mailtraxx/mailtraxx.db` | SQLite database file |
| `--retain <n>` | 500 | Messages kept per inbox |
| `--max-size <mb>` | 25 | Largest message accepted |
| `--open` | off | Open the UI in a browser on start |

## Spring Boot

```yaml
spring:
  mail:
    host: localhost
    port: 2525
    username: my-app     # becomes the inbox name
    password: anything
    properties:
      '[mail.smtp.auth]': true
```

## What it does not do

No attachment downloads, no spam scoring, no forwarding to real recipients, and no remote access —
both listeners bind to `127.0.0.1` only.

## Development

```bash
npm test          # server and UI tests
npm run dev:server # server with --watch
npm run dev:ui     # Angular dev server, proxying /api to port 1080
```
````

- [ ] **Step 8: Commit**

```bash
git add README.md package.json
git commit -m "docs: add README and root build scripts"
```

- [ ] **Step 9: Confirm nothing needs committing in callforpapers**

```bash
cd /Users/stephan/projects/callforpapers && git status --short
```

Expected: clean. `.env` is gitignored, so redirecting dev mail to mailtraxx leaves no tracked change. If you took the `application-dev.yml` fallback in Step 5 instead, commit it there deliberately — it changes where *every* developer's dev mail goes.

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-08-12-mailtraxx-design.md`:

- Every spec section maps to a task: architecture units → Tasks 2–8; inbox model → Tasks 2 and 5; data model and retention → Tasks 2–3; HTTP API (all 8 routes) → Task 7; SSE → Tasks 6–7; UI components → Tasks 10–11; HTML preview safety → Task 11; all six error-handling rows → Tasks 5, 7, and 8; the test pyramid → distributed across all tasks; callforpapers integration → Task 12.
- Placeholder scan: clean. Two spots that originally showed wrong code followed by a correction step — a bad CSS token value and SSE wiring that only handled unnamed frames — now show the correct code directly.
- Type names are consistent across tasks: `SqliteStore`, `SaveResult`, `ParsedMessage`, `MessageSummary`, `Message`, `Inbox`, `AttachmentMeta`, `MailtraxxEvent`, `SmtpHandle`, `WebHandle`. The UI's `models.ts` mirrors the server's `types.ts` field for field.
