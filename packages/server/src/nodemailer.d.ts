// `nodemailer` ships no type declarations and no `@types/nodemailer` is
// installed. This declares only the surface `smtp.test.ts` actually uses as
// a test client, not the full nodemailer API.
declare module 'nodemailer' {
  export interface TransportOptions {
    host: string;
    port: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  }

  export interface MailOptions {
    from: string;
    to: string;
    subject: string;
    html?: string;
    text?: string;
  }

  export interface Transporter {
    options: TransportOptions;
    sendMail(mail: MailOptions): Promise<unknown>;
    close(): void;
  }

  export function createTransport(options: TransportOptions): Transporter;

  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
