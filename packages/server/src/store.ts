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
