import type { SentinelEvent } from "./events.js";

/**
 * Producers (e.g. ReportWatcher) depend on this instead of a concrete
 * dispatcher implementation, so they stay decoupled and testable.
 */
export interface IEventPublisher {
  publish(event: SentinelEvent): void;
}
