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
