# mailtraxx — design

**Date:** 2026-08-12
**Status:** approved

## Purpose

A local replacement for [mailtrap.io](https://mailtrap.io): a fake SMTP server that catches every
email your local apps send, stores it, and shows it in a browser UI — so you can verify that mail
is generated and formatted correctly without ever delivering it to a real speaker.

The immediate consumer is `/Users/stephan/projects/callforpapers`, a Spring Boot app whose dev
profile currently points at `smtp.mailtrap.io:2525`. Switching it to mailtraxx must be a one-line
config change.

## Constraints that shaped the design

1. **The client speaks SMTP, not HTTP.** callforpapers uses `spring.mail` with
   `mail.smtp.auth=true` and `mail.smtp.starttls.enable=true`. Anything that requires the sending
   app to POST JSON is out — it would mean changing application code, not config.
2. **No cloud dependency.** An earlier iteration of this design put the UI on Firebase (Hosting +
   Firestore + Functions + Google OAuth) with a local SMTP daemon writing through the Admin SDK.
   That was dropped: Firebase cannot accept inbound raw TCP, so the daemon was needed anyway, and
   everything else it bought (auth, hosted DB, sync) is dead weight for a single developer testing
   on their own machine. mailtraxx is one process with no network egress and no credentials to
   manage.
3. **Local-only by default.** Captured mail is unsent mail, often containing real addresses and
   tokens. Both listeners bind to `127.0.0.1`.

## Non-goals (v1)

Deliberately excluded, per scoping decisions during design:

- Attachment **content** storage (metadata only — see Data model)
- A documented, token-authenticated API for programmatic test assertions. The SPA's JSON API
  below exists to serve the UI and is not a stability contract; nothing outside mailtraxx should
  depend on it yet.
- Spam scoring, HTML/CSS compatibility checks, link checking
- Message forwarding to real recipients
- Multi-user accounts, projects, teams, sharing
- Remote/hosted deployment

## Architecture

One npm package, one process, started with `npx mailtraxx`.

```
                  callforpapers (Spring Boot)
                            │ SMTP :2525
                            ▼
   ┌─────────────────────────────────────────────┐
   │ mailtraxx process                           │
   │                                             │
   │   smtp/  ──parse──►  store/  ◄──query──  web/   │
   │   (smtp-server,      (node:sqlite)      (http + SSE)
   │    mailparser)             │                │
   │                            ▼                │
   │                  ~/.mailtraxx/mailtraxx.db  │
   └─────────────────────────────────────────────┘
                            │ HTTP :1080
                            ▼
                   Angular 22 SPA (ui/)
```

### Units

Each unit is independently testable and talks to the others through a narrow interface.

| Unit | Responsibility | Interface it exposes | Depends on |
|---|---|---|---|
| `smtp/` | Accept SMTP connections, parse MIME into a `ParsedMessage` | `startSmtpServer(opts, store): Promise<Server>` | `smtp-server` ^3.19, `mailparser` ^3.9 |
| `store/` | Persist and query messages; enforce retention | `MessageStore` (see below) | `node:sqlite` |
| `web/` | Serve the SPA bundle, the JSON API, and the SSE stream | `startWebServer(opts, store, bus): Promise<Server>` | `node:http` |
| `bus/` | In-process event fan-out from store writes to SSE clients | `EventBus` (`emit`, `subscribe`) | — |
| `ui/` | Angular 22 SPA | — | `web/` API |

`smtp/` never touches HTTP; `web/` never touches SMTP. Both know only `MessageStore` and `EventBus`.

### Runtime

- **Node 22+** (verified on v22.22.3). `node:sqlite` works there unflagged but emits an
  `ExperimentalWarning`; the `bin` entry suppresses it (`--no-warnings=ExperimentalWarning`) so
  startup output stays clean.
- **TypeScript** for the server, compiled to `dist/`.
- **npm workspaces**: `packages/server` and `packages/ui`. The server serves the UI's built
  browser bundle as static files; in development the Angular dev server proxies `/api` to
  the running mailtraxx process.

### Console output

The process is its own console. On start:

```
mailtraxx  SMTP 127.0.0.1:2525   UI http://localhost:1080
```

and one line per captured message:

```
← 14:22:01  no_reply+dev@cfp.dev → speaker@example.com  "Your talk was accepted"  [240f00ce858a00]
```

## Inbox model

Mailtrap issues per-inbox SMTP credentials. Locally that ceremony buys nothing, so mailtraxx
**accepts any username and password**. The inbox is chosen by SMTP username:

- Authenticated connection → inbox named after the username, created on first use.
- Unauthenticated connection → inbox named `default`, created on first use.

callforpapers keeps its existing `username: 240f00ce858a00` and gets a dedicated inbox with no
setup. Inboxes can be renamed from the UI (rename changes the display label only; routing stays
keyed on the immutable SMTP username).

Accepting any password is a deliberate trade: the server is bound to loopback, so anything that
can reach it can already read the database file.

## Data model

SQLite at `~/.mailtraxx/mailtraxx.db` (override with `--db`). Schema:

```sql
CREATE TABLE inboxes (
  id           INTEGER PRIMARY KEY,
  smtp_user    TEXT NOT NULL UNIQUE,   -- routing key; 'default' for unauthenticated
  name         TEXT NOT NULL,          -- display label, editable
  created_at   TEXT NOT NULL
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY,
  inbox_id      INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  message_id    TEXT,                  -- Message-ID header, may be null
  from_addr     TEXT NOT NULL,         -- envelope MAIL FROM
  from_display  TEXT,                  -- From: header, as sent
  to_addrs      TEXT NOT NULL,         -- JSON array, envelope RCPT TO
  cc_addrs      TEXT,                  -- JSON array from headers
  subject       TEXT,
  html          TEXT,
  text          TEXT,
  raw           TEXT NOT NULL,         -- full RFC822 source, always stored
  headers       TEXT NOT NULL,         -- JSON object
  size_bytes    INTEGER NOT NULL,
  parse_error   TEXT,                  -- null when parsing succeeded
  received_at   TEXT NOT NULL          -- ISO-8601
);
CREATE INDEX idx_messages_inbox_received ON messages(inbox_id, received_at DESC);

CREATE TABLE attachments (
  id           INTEGER PRIMARY KEY,
  message_id   INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename     TEXT,
  content_type TEXT,
  size_bytes   INTEGER NOT NULL
);
```

`raw` is stored unconditionally, even when parsing fails — it is the fallback view when structured
parsing doesn't produce something useful. It is decoded and stored as a UTF-8 string, which is
byte-exact only for messages whose non-ASCII content uses an ASCII-safe transfer encoding
(quoted-printable, base64, 7bit) — true of both senders in scope (Jakarta Mail, nodemailer). A
message using raw 8-bit bytes outside valid UTF-8 will have those bytes replaced with U+FFFD, so
`raw` is not a byte-exact source of truth in that case. See `README.md` "Known limitations".

Attachment **content** is not stored in v1. The metadata row records that an attachment existed
so the UI can show it; downloading it is not offered. The attachment may be recoverable from the
`raw` column, subject to the same UTF-8 fidelity caveat above — it is not guaranteed byte-exact.

**Retention:** on insert, keep the newest 500 messages per inbox and delete older ones
(configurable via `--retain`). This bounds the database without a background job.

**Search:** `q` matches `subject`, `from_display`, and `to_addrs` with SQL `LIKE`. FTS is not
worth it at a 500-message ceiling.

### `MessageStore` interface

```ts
interface MessageStore {
  listInboxes(): Inbox[];
  renameInbox(id: number, name: string): void;
  listMessages(inboxId: number, opts: { q?: string; limit: number; offset: number }): MessageSummary[];
  getMessage(id: number): Message | undefined;
  saveMessage(m: ParsedMessage): Message;   // creates the inbox if needed, prunes, returns saved row
  deleteMessage(id: number): void;
  clearInbox(inboxId: number): void;
}
```

## HTTP API

All responses JSON unless noted. Served from the same origin as the SPA, so no CORS.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/inboxes` | id, name, smtp_user, message count, latest received_at |
| `PATCH` | `/api/inboxes/:id` | `{ name }` — rename |
| `GET` | `/api/inboxes/:id/messages` | query: `q`, `limit` (default 50), `offset` |
| `GET` | `/api/messages/:id` | full message including html, text, headers, attachment metadata |
| `GET` | `/api/messages/:id/raw` | `text/plain`, `Content-Disposition: attachment; filename=<id>.eml` |
| `DELETE` | `/api/messages/:id` | |
| `DELETE` | `/api/inboxes/:id/messages` | clear inbox |
| `GET` | `/api/events` | SSE stream |

SSE event types: `message.created` (payload: message summary + inbox id), `inbox.created`,
`message.deleted`, `messages.cleared`. This is what makes the list update the instant callforpapers
sends, with no polling.

## UI (Angular 22)

Three-pane layout, deliberately close to Mailtrap's: inbox sidebar → message list → message viewer.

**Angular 22 conventions used throughout:**

- Standalone components; no NgModules
- Zoneless change detection (`provideZonelessChangeDetection()`) — SSE updates land in signals,
  so there is nothing for Zone.js to patch
- Signals and `httpResource()` for data loading; templates branch on `hasValue()` / `isLoading()` /
  `error()`
- Built-in control flow (`@if`, `@for`, `@switch`)
- `input()` / `output()` functions and `inject()` rather than constructor injection
- Scaffolded with `npx @angular/cli@22 new ui`

**Components:**

| Component | Responsibility |
|---|---|
| `InboxList` | Sidebar; inboxes with message counts; rename; clear |
| `MessageList` | Middle pane; search box, paged list, live-prepends on SSE |
| `MessageViewer` | Right pane; header summary plus HTML / Text / Raw / Headers tabs |
| `HtmlPreview` | Sandboxed iframe rendering of the HTML part |

**Services:** `MailtraxxApi` (typed HTTP), `LiveFeed` (SSE → signal), `SelectionState` (selected
inbox/message, mirrored into the route so views are linkable).

**HTML preview safety.** Captured mail is untrusted input rendered in your browser. The HTML part
renders in an `<iframe srcdoc>` with a `sandbox` attribute that omits `allow-scripts` and
`allow-same-origin`, plus a CSP meta that blocks remote subresources. A "load remote content"
toggle relaxes the image rule per message, mirroring how real mail clients behave — and making
tracking-pixel behaviour visible rather than automatic.

## Error handling

| Situation | Behaviour |
|---|---|
| SMTP or HTTP port already in use | Named error identifying the port and the flag to change it; exit code 1 |
| Unparseable / malformed MIME | Message still stored with `raw` and `parse_error`; UI opens it on the Raw tab |
| Message exceeds max size (default 25 MB, `--max-size`) | SMTP `552 Message size exceeds fixed maximum` |
| Store write fails | SMTP `451 Local error in processing` — the sending app must see a failure rather than have mail silently vanish |
| Unknown API path | `404` with a JSON error body |
| Corrupt or unreadable database file | Startup error naming the path; no silent re-create |

## Testing

`node:test` for the server, Angular's default runner for the UI.

**Unit**
- `store/`: insert → read back; retention pruning at the boundary; search matching; cascade delete
- `smtp/` parsing: HTML-only message, text-only message, both parts, attachment metadata
  extraction, 8-bit and quoted-printable encodings, message with no `Subject`

**Integration**
- nodemailer client → server on an ephemeral port → assert row in SQLite, assert
  `GET /api/messages/:id` returns it, assert an SSE `message.created` fired
- Oversized message → SMTP `552`, nothing stored
- Store made to fail → SMTP `451`

**Acceptance**
Point callforpapers' dev profile at mailtraxx, trigger a speaker email, confirm it appears in the
UI with correct subject, recipients, and HTML rendering.

## Integrating callforpapers

callforpapers points its dev profile at mailtrap.io in
`src/main/resources/application-dev.yml`:

```yaml
  mail:
    host: smtp.mailtrap.io
    username: 240f00ce858a00
    password: b6cba990e80601
    port: 2525
    properties:
      '[mail.smtp.auth]': true
      '[mail.smtp.starttls.enable]': true
```

Only the host has to change, and it should change *locally*, not in tracked config: that file is
shared, so editing it would redirect every developer's dev mail to a mailtraxx they aren't running.
callforpapers loads an untracked `.env` through mise (`mise.toml`: `_.file = [".env"]`;
`.gitignore:12` ignores `/.env`), and Spring Boot's relaxed binding maps `SPRING_MAIL_HOST` onto
`spring.mail.host`. So the whole integration is one line in that local file:

```bash
SPRING_MAIL_HOST=localhost
```

Port, username, password, and the `mail.smtp.*` properties stay untouched. The username becomes the
inbox name; the password is accepted whatever it is.

`starttls.enable=true` is *opportunistic* in Jakarta Mail: the client uses STARTTLS only if the
server advertises it. mailtraxx does not, so the client falls back to plaintext — which means the
server must set `allowInsecureAuth: true` to accept AUTH on an unencrypted connection. Verify this
against a real send from callforpapers, not just a hand-rolled SMTP client.

Sending is already on: `application.yml:351` sets `cfp.mail.enabled: ${CFP_MAIL_ENABLED:true}`, read
by `SendMailService`. The `management.health.mail.enabled: false` further up that file is the
Actuator *health indicator*, not a send toggle — leave it alone.

## CLI

```
npx mailtraxx [options]

  --smtp-port <n>    SMTP listen port           (default 2525)
  --http-port <n>    Web UI / API port          (default 1080)
  --db <path>        SQLite file                (default ~/.mailtraxx/mailtraxx.db)
  --retain <n>       Messages kept per inbox    (default 500)
  --max-size <mb>    Max accepted message size  (default 25)
  --open             Open the UI in a browser on start
```
