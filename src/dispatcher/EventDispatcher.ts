import { EventEmitter } from "node:events";
import type { ILogger } from "../logger/ILogger.js";
import type { IEventPublisher } from "./IEventPublisher.js";
import { withRetry, type RetryOptions } from "./retry.js";
import type { SentinelEvent, SentinelEventType } from "./events.js";

type HandlerFor<T extends SentinelEventType> = (
  event: Extract<SentinelEvent, { type: T }>,
) => void | Promise<void>;

type AnyHandler = (event: SentinelEvent) => void | Promise<void>;

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  delayMs: 500,
  backoffFactor: 2,
};

/**
 * Event-driven dispatcher backed by Node's EventEmitter.
 *
 * - `on` subscribes a typed listener for one event type. Failures are
 *   retried with backoff; if every attempt fails, a SENTINEL_ERROR event is
 *   published instead of crashing the process (so one broken listener can't
 *   take down the pipeline).
 * - `onAny` subscribes a listener to every event regardless of type - used
 *   by EventLogListener to persist the full event stream without a
 *   per-type case. onAny handlers are best-effort (logged, not retried) so
 *   a logging failure can never cascade into further error events.
 */
export class EventDispatcher implements IEventPublisher {
  private readonly emitter = new EventEmitter();
  private readonly anyHandlers: AnyHandler[] = [];

  constructor(
    private readonly logger: ILogger,
    private readonly retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS,
  ) {}

  publish(event: SentinelEvent): void {
    this.logger.info("Event published", { type: event.type });
    this.emitter.emit(event.type, event);

    for (const handler of this.anyHandlers) {
      void Promise.resolve(handler(event)).catch((error: unknown) => {
        this.logger.error("onAny handler failed", {
          type: event.type,
          error: String(error),
        });
      });
    }
  }

  on<T extends SentinelEventType>(type: T, handler: HandlerFor<T>): void {
    this.emitter.on(type, (event: SentinelEvent) => {
      const typedEvent = event as Extract<SentinelEvent, { type: T }>;

      void withRetry(
        () => Promise.resolve(handler(typedEvent)),
        this.retryOptions,
        (attempt, error) => {
          this.logger.warn("Event handler attempt failed", {
            type,
            attempt,
            error: String(error),
          });
        },
      ).catch((error: unknown) => {
        this.logger.error("Event handler failed after retries", {
          type,
          error: String(error),
        });

        if (event.type !== "SENTINEL_ERROR") {
          this.publish({
            type: "SENTINEL_ERROR",
            payload: {
              sourceEventType: event.type,
              message: error instanceof Error ? error.message : String(error),
              occurredAt: new Date(),
            },
          });
        }
      });
    });
  }

  onAny(handler: AnyHandler): void {
    this.anyHandlers.push(handler);
  }
}
