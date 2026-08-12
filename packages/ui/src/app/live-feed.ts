import { Injectable, signal } from '@angular/core';
import type { MailtraxxEvent } from './models';

const EVENT_TYPES = ['message.created', 'inbox.created', 'message.deleted', 'messages.cleared'] as const;

/**
 * Holds the SSE connection to the server. Components react by reading
 * `lastEvent()` — the signal is the seam between the socket and the UI.
 */
@Injectable({ providedIn: 'root' })
export class LiveFeed {
  readonly #lastEvent = signal<MailtraxxEvent | null>(null);
  readonly #connected = signal(false);

  readonly lastEvent = this.#lastEvent.asReadonly();
  readonly connected = this.#connected.asReadonly();

  constructor() {
    const source = new EventSource('/api/events');
    source.onopen = () => this.#connected.set(true);
    source.onerror = () => this.#connected.set(false);

    const receive = (event: MessageEvent) => {
      try {
        this.#lastEvent.set(JSON.parse(event.data as string) as MailtraxxEvent);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    // The server sends *named* events (`event: message.created`), which browsers
    // deliver to per-type listeners rather than to onmessage. onmessage stays as a
    // fallback for unnamed frames.
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, receive as EventListener);
    }
    source.onmessage = receive;
  }
}
