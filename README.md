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

## Known limitations

The raw `.eml` download (`GET /api/messages/:id/raw`) is byte-exact only for messages whose
non-ASCII content uses an ASCII-safe transfer encoding — quoted-printable, base64, or plain 7bit.
A message that instead uses raw 8-bit bytes outside valid UTF-8 (e.g. an `iso-8859-1` body sent
without such an encoding) will have those bytes replaced with the Unicode replacement character
(`U+FFFD`) when stored, so its downloaded `.eml` will not round-trip byte-for-byte. Both senders
in scope for this project (Jakarta Mail, nodemailer) encode non-ASCII as quoted-printable or
base64, so this does not affect them in practice.

## Development

```bash
npm test          # server and UI tests
npm run dev:server # server with --watch
npm run dev:ui     # Angular dev server, proxying /api to port 1080
```

## License

[MIT](LICENSE) © 2026 Stephan Janssen
