import { LRUCache } from "lru-cache";

type RateLimitOptions = {
  interval: number; // Time window in milliseconds
  uniqueTokenPerInterval: number; // Max unique tokens (IPs)
};

export type RateLimitResult = {
  success: boolean;
  remaining: number;
  resetAt: number | null;
  retryAfterMs: number | null;
};

export class RateLimiter {
  private tokenCache: LRUCache<string, number[]>;
  private interval: number;
  private maxRequests: number;

  constructor(maxRequests: number, options: RateLimitOptions) {
    this.maxRequests = maxRequests;
    this.interval = options.interval;
    this.tokenCache = new LRUCache({
      max: options.uniqueTokenPerInterval,
      ttl: options.interval,
    });
  }

  check(identifier: string): RateLimitResult {
    const now = Date.now();
    const tokenKey = identifier;

    const timestamps = this.tokenCache.get(tokenKey) ?? [];
    const windowStart = now - this.interval;

    const recentTimestamps = timestamps.filter((ts) => ts > windowStart);

    if (recentTimestamps.length >= this.maxRequests) {
      const earliest = recentTimestamps[0] ?? now;
      const retryAfterMs = Math.max(this.interval - (now - earliest), 0);
      return {
        success: false,
        remaining: 0,
        resetAt: now + retryAfterMs,
        retryAfterMs,
      };
    }

    recentTimestamps.push(now);
    this.tokenCache.set(tokenKey, recentTimestamps);
    const earliest = recentTimestamps[0] ?? now;

    return {
      success: true,
      remaining: this.maxRequests - recentTimestamps.length,
      resetAt: earliest ? earliest + this.interval : null,
      retryAfterMs: null,
    };
  }
}

export const loginLimiter = new RateLimiter(5, {
  interval: 15 * 60 * 1000, // 15 minutes
  uniqueTokenPerInterval: 500,
});

export const signupLimiter = new RateLimiter(3, {
  interval: 60 * 60 * 1000, // 1 hour
  uniqueTokenPerInterval: 500,
});

export function getClientIp(source: Request | Headers): string {
  const headers = source instanceof Headers ? source : source.headers;
  const forwarded = headers.get("x-forwarded-for");
  const realIp = headers.get("x-real-ip");

  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }

  return realIp ?? "unknown";
}
