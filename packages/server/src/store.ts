import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Inbox, Message, MessageSummary, ParsedMessage, SaveResult, AttachmentMeta } from './types.ts';

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

export class SqliteStore {
  readonly #db: DatabaseSync;
  readonly #retain: number;

  constructor(dbPath: string, retain: number) {
    try {
      if (dbPath !== ':memory:') {
        mkdirSync(dirname(dbPath), { recursive: true });
      }
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
    const row = this.#db
      .prepare('SELECT *, (html IS NOT NULL) AS has_html FROM messages WHERE id = ?')
      .get(id) as unknown as MessageRow | undefined;
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

  close(): void {
    this.#db.close();
  }
}
