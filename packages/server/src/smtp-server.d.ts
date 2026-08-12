// `smtp-server` ships no type declarations and no matching `@types` package
// is available. This declares only the surface `smtp.ts` actually uses,
// shaped to the installed 3.19.x API (verified against
// node_modules/smtp-server/lib/*.js) — e.g. `onAuth`'s first argument really
// is `{ method, username, authcid, authzid, password }`, and `session.user`
// is whatever `onAuth`'s callback response `.user` was, not a fixed shape.
// A bare `declare module 'smtp-server';` (shorthand ambient module) would
// type the whole import as `any` and defeat `strict` checking; this explicit
// body is what keeps typos and bogus options an error instead of silently
// passing.
declare module 'smtp-server' {
  import type { Server as NetServer } from 'node:net';
  import type { Readable } from 'node:stream';

  export interface SMTPServerAddress {
    address: string;
    args: Record<string, string | boolean>;
  }

  export interface SMTPServerEnvelope {
    mailFrom: SMTPServerAddress | false;
    rcptTo: SMTPServerAddress[];
  }

  export interface SMTPServerSession {
    id: string;
    user?: unknown;
    envelope: SMTPServerEnvelope;
  }

  export interface SMTPServerAuthentication {
    method: string;
    username?: string;
    authcid?: string;
    authzid?: string;
    password?: string;
  }

  export interface SMTPServerAuthenticationResponse {
    user: unknown;
  }

  export interface SMTPServerDataStream extends Readable {
    sizeExceeded: boolean;
  }

  export interface SMTPServerOptions {
    name?: string;
    banner?: string;
    size?: number;
    authOptional?: boolean;
    allowInsecureAuth?: boolean;
    disabledCommands?: string[];
    hideSTARTTLS?: boolean;
    onAuth?(
      auth: SMTPServerAuthentication,
      session: SMTPServerSession,
      callback: (
        err: (Error & { responseCode?: number }) | null,
        response?: SMTPServerAuthenticationResponse,
      ) => void,
    ): void;
    onData?(
      stream: SMTPServerDataStream,
      session: SMTPServerSession,
      callback: (err?: (Error & { responseCode?: number }) | null, message?: string) => void,
    ): void;
  }

  export class SMTPServer {
    readonly server: NetServer;
    constructor(options: SMTPServerOptions);
    listen(port: number, host: string, callback: () => void): void;
    close(callback: () => void): void;
    once(event: 'error', listener: (err: Error) => void): this;
    off(event: 'error', listener: (err: Error) => void): this;
  }
}
