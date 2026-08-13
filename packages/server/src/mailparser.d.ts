// `mailparser` ships no type declarations and no `@types/mailparser` matching
// the installed 3.9.x API is available. This declares only the surface
// `parse.ts` actually reads, shaped to mailparser's real (empirically
// verified) behavior — e.g. `html`/`filename` are `false`, not `undefined`,
// when absent. A bare `declare module 'mailparser';` (shorthand ambient
// module) would type the whole import as `any` and defeat `strict`
// checking; this explicit body is what keeps typos and bogus options an
// error instead of silently passing.
declare module 'mailparser' {
  export interface AddressEntry {
    name?: string;
    address?: string;
  }

  export interface AddressObject {
    value: AddressEntry[];
    text: string;
  }

  export interface Attachment {
    filename?: string | false;
    contentType?: string;
    size: number;
  }

  export interface ParsedMail {
    messageId?: string;
    from?: AddressObject;
    cc?: AddressObject | AddressObject[];
    subject?: string;
    html: string | false;
    text?: string;
    headers: Map<string, unknown>;
    attachments: Attachment[];
  }

  export interface SimpleParserOptions {
    skipHtmlToText?: boolean;
    skipTextToHtml?: boolean;
  }

  export function simpleParser(source: Buffer | string, options?: SimpleParserOptions): Promise<ParsedMail>;
}
