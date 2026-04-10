import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";

export const DELIVERY_QUEUE = "hooksmith.delivery";

// Exponential backoff schedule in ms, capped at 6 attempts total (5 retries).
// Order: 10s, 30s, 2m, 10m, 1h, 6h
export const RETRY_DELAYS_MS = [
  10_000,
  30_000,
  120_000,
  600_000,
  3_600_000,
  21_600_000,
];

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

export type DeliveryJob = {
  deliveryId: string;
};

// Lazy singletons — do not open a Redis connection at module load time,
// because that would break `next build` (page data collection) and any
// other process that merely imports this file.

let _connection: Redis | null = null;
let _queue: Queue<DeliveryJob> | null = null;

export function getConnection(): Redis {
  if (!_connection) {
    _connection = new IORedis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      { maxRetriesPerRequest: null },
    );
  }
  return _connection;
}

export function getDeliveryQueue(): Queue<DeliveryJob> {
  if (!_queue) {
    _queue = new Queue<DeliveryJob>(DELIVERY_QUEUE, {
      connection: getConnection(),
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return _queue;
}

/**
 * Backoff for attempt N (0-indexed). Returns the delay in ms before attempting again.
 */
export function backoffForAttempt(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}
