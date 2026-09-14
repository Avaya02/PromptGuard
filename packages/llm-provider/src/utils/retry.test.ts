import { describe, expect, it, vi } from "vitest";

import { HttpError, isRetryableStatus, withRetry } from "./retry.js";

describe("isRetryableStatus", () => {
  it("treats rate limits and server errors as retryable", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it("treats client errors as terminal", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });
});

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const operation = vi.fn(async () => "ok");
    await expect(withRetry(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and succeeds on a later attempt", async () => {
    let calls = 0;
    const operation = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new HttpError(429, "rate limited");
      }
      return "recovered";
    });

    const result = await withRetry(operation, { attempts: 3, baseDelayMs: 1 });

    expect(result).toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("gives up after the attempt budget and rethrows", async () => {
    const operation = vi.fn(async () => {
      throw new HttpError(503, "unavailable");
    });

    await expect(withRetry(operation, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow(HttpError);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 401", async () => {
    const operation = vi.fn(async () => {
      throw new HttpError(401, "bad key");
    });

    await expect(withRetry(operation, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow(HttpError);
    // A bad key will never resolve itself, so burning retries on it is waste.
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-HTTP error", async () => {
    const operation = vi.fn(async () => {
      throw new Error("parse failure");
    });

    await expect(withRetry(operation, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow(
      "parse failure"
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("backs off for longer on each successive attempt", async () => {
    const waits: number[] = [];
    let last = Date.now();

    const operation = vi.fn(async () => {
      const now = Date.now();
      waits.push(now - last);
      last = now;
      throw new HttpError(429, "rate limited");
    });

    await expect(
      withRetry(operation, { attempts: 3, baseDelayMs: 20, maxDelayMs: 1000 })
    ).rejects.toThrow();

    // waits[0] is the initial call; compare the two backoff gaps.
    expect(waits).toHaveLength(3);
    expect(waits[2]).toBeGreaterThan(waits[1]! * 1.2);
  });

  it("honours maxDelayMs as a ceiling", async () => {
    const started = Date.now();
    const operation = vi.fn(async () => {
      throw new HttpError(429, "rate limited");
    });

    await expect(
      withRetry(operation, { attempts: 3, baseDelayMs: 1000, maxDelayMs: 10 })
    ).rejects.toThrow();

    // Two capped backoffs of ~10ms each, plus jitter, must stay well under the
    // uncapped 1000 + 2000 the base delay would otherwise produce.
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("HttpError", () => {
  it("carries status and body", () => {
    const error = new HttpError(429, "slow down");
    expect(error.status).toBe(429);
    expect(error.body).toBe("slow down");
    expect(error.name).toBe("HttpError");
    expect(error).toBeInstanceOf(Error);
  });
});
