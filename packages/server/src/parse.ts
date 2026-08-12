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
 * `AddressObject#text` quotes display names (`"Devoxx CFP" <...>`), which is
 * valid RFC5322 but not the unquoted form the UI wants. Build the display
 * string from the structured `value` entry instead of using `.text`.
 */
function formatFromDisplay(parsed: Awaited<ReturnType<typeof simpleParser>>): string | null {
  const entry = parsed.from?.value?.[0];
  if (!entry) return null;
  if (!entry.address) return entry.name || null;
  return entry.name ? `${entry.name} <${entry.address}>` : entry.address;
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
    // Keep only what was actually in the message: don't synthesize a text
    // part from html or vice versa (mailparser does both by default).
    const parsed = await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true });
    return {
      ...base,
      messageId: parsed.messageId ?? null,
      fromDisplay: formatFromDisplay(parsed),
      ccAddrs: ccAddresses(parsed),
      subject: parsed.subject ?? null,
      html: typeof parsed.html === 'string' ? parsed.html : null,
      text: parsed.text || null,
      headers: flattenHeaders(parsed.headers as Map<string, unknown>),
      attachments: parsed.attachments.map(
        (a): AttachmentMeta => ({
          filename: a.filename || null,
          contentType: a.contentType ?? null,
          sizeBytes: a.size,
        }),
      ),
    };
  } catch (cause) {
    return { ...base, parseError: (cause as Error).message };
  }
}
