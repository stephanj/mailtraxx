import type { Inbox, MessageSummary } from './types.ts';

export type MailtraxxEvent =
  | { type: 'message.created'; message: MessageSummary }
  | { type: 'inbox.created'; inbox: Inbox }
  | { type: 'message.deleted'; id: number; inboxId: number }
  | { type: 'messages.cleared'; inboxId: number };

export type EventListener = (event: MailtraxxEvent) => void;

export class EventBus {
  readonly #listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: MailtraxxEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (err) {
        // A dead SSE connection must not take down mail capture.
        console.error('mailtraxx: event listener failed:', err);
      }
    }
  }
}
