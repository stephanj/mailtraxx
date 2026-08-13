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
