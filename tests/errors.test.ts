import { describe, expect, test, beforeEach, mock } from "bun:test";
import {
  UCPError,
  NetworkError,
  MerchantError,
  ValidationError,
  AuthError,
  RateLimitError,
  TimeoutError,
  getUserFriendlyMessage,
  createErrorFromException,
  calculateRetryDelay,
  isRetryableError,
  withRetry,
  createLogger,
  withRecovery,
  fallbackStrategy,
  cachedStrategy,
  type RetryConfig,
} from "../src/agent/errors";

describe("Error Types", () => {
  describe("UCPError", () => {
    test("creates error with all properties", () => {
      const error = new UCPError("Test error", "TEST_CODE", true, { foo: "bar" });

      expect(error.message).toBe("Test error");
      expect(error.code).toBe("TEST_CODE");
      expect(error.retryable).toBe(true);
      expect(error.context).toEqual({ foo: "bar" });
      expect(error.name).toBe("UCPError");
    });

    test("toJSON serializes correctly", () => {
      const error = new UCPError("Test", "CODE", false, { key: "value" });
      const json = error.toJSON();

      expect(json.name).toBe("UCPError");
      expect(json.message).toBe("Test");
      expect(json.code).toBe("CODE");
      expect(json.retryable).toBe(false);
      expect(json.context).toEqual({ key: "value" });
    });
  });

  describe("NetworkError", () => {
    test("is retryable by default", () => {
      const error = new NetworkError("Connection failed");
      expect(error.retryable).toBe(true);
      expect(error.code).toBe("NETWORK_ERROR");
      expect(error.name).toBe("NetworkError");
    });
  });

  describe("MerchantError", () => {
    test("includes status code", () => {
      const error = new MerchantError("Not found", 404, false);
      expect(error.statusCode).toBe(404);
      expect(error.retryable).toBe(false);
    });

    test("server errors are retryable", () => {
      const error = new MerchantError("Server error", 500, true);
      expect(error.retryable).toBe(true);
    });
  });

  describe("ValidationError", () => {
    test("includes field name", () => {
      const error = new ValidationError("Invalid email", "email");
      expect(error.field).toBe("email");
      expect(error.retryable).toBe(false);
      expect(error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("AuthError", () => {
    test("is not retryable", () => {
      const error = new AuthError("Unauthorized");
      expect(error.retryable).toBe(false);
      expect(error.code).toBe("AUTH_ERROR");
    });
  });

  describe("RateLimitError", () => {
    test("includes retry after time", () => {
      const error = new RateLimitError("Too many requests", 5000);
      expect(error.retryAfterMs).toBe(5000);
      expect(error.retryable).toBe(true);
    });
  });

  describe("TimeoutError", () => {
    test("includes timeout duration", () => {
      const error = new TimeoutError("Request timed out", 30000);
      expect(error.timeoutMs).toBe(30000);
      expect(error.retryable).toBe(true);
    });
  });
});

describe("getUserFriendlyMessage", () => {
  test("returns friendly message for UCPError", () => {
    const error = new NetworkError("ECONNREFUSED");
    const message = getUserFriendlyMessage(error);
    expect(message).toContain("trouble connecting");
  });

  test("returns friendly message for merchant error", () => {
    const error = new MerchantError("Server error", 500);
    const message = getUserFriendlyMessage(error);
    expect(message).toContain("temporarily unavailable");
  });

  test("returns friendly message for validation error", () => {
    const error = new ValidationError("Invalid input");
    const message = getUserFriendlyMessage(error);
    expect(message).toContain("issue with the information");
  });

  test("returns friendly message for rate limit error", () => {
    const error = new RateLimitError("Rate limited");
    const message = getUserFriendlyMessage(error);
    expect(message).toContain("too many requests");
  });

  test("detects network errors from regular Error", () => {
    const error = new Error("fetch failed: ECONNREFUSED");
    const message = getUserFriendlyMessage(error);
    expect(message).toContain("trouble connecting");
  });

  test("detects timeout errors from regular Error", () => {
    const error = new Error("Request timed out");
    const message = getUserFriendlyMessage(error);
    expect(message).toContain("took too long");
  });

  test("returns generic message for unknown errors", () => {
    const message = getUserFriendlyMessage("random string");
    expect(message).toContain("unexpected");
  });
});

describe("createErrorFromException", () => {
  test("passes through UCPError unchanged", () => {
    const original = new NetworkError("Test");
    const result = createErrorFromException(original);
    expect(result).toBe(original);
  });

  test("converts network-related errors", () => {
    const error = new Error("fetch failed");
    const result = createErrorFromException(error);
    expect(result).toBeInstanceOf(NetworkError);
  });

  test("converts timeout errors", () => {
    const error = new Error("Request timed out");
    const result = createErrorFromException(error);
    expect(result).toBeInstanceOf(TimeoutError);
  });

  test("converts abort errors", () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    const result = createErrorFromException(error);
    expect(result).toBeInstanceOf(TimeoutError);
  });

  test("creates generic UCPError for unknown errors", () => {
    const error = new Error("Some random error");
    const result = createErrorFromException(error);
    expect(result).toBeInstanceOf(UCPError);
    expect(result.code).toBe("UNKNOWN_ERROR");
  });

  test("handles non-Error values", () => {
    const result = createErrorFromException("string error");
    expect(result).toBeInstanceOf(UCPError);
    expect(result.message).toBe("string error");
  });

  test("includes context", () => {
    const error = new Error("Test");
    const result = createErrorFromException(error, { url: "http://test.com" });
    expect(result.context).toEqual({ url: "http://test.com" });
  });
});

describe("Retry Logic", () => {
  describe("calculateRetryDelay", () => {
    const config: RetryConfig = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitter: false,
    };

    test("calculates exponential backoff", () => {
      expect(calculateRetryDelay(0, config)).toBe(1000);
      expect(calculateRetryDelay(1, config)).toBe(2000);
      expect(calculateRetryDelay(2, config)).toBe(4000);
      expect(calculateRetryDelay(3, config)).toBe(8000);
    });

    test("respects max delay", () => {
      const smallMax = { ...config, maxDelayMs: 3000 };
      expect(calculateRetryDelay(5, smallMax)).toBe(3000);
    });

    test("adds jitter when enabled", () => {
      const withJitter = { ...config, jitter: true };
      const delays = Array.from({ length: 10 }, () =>
        calculateRetryDelay(1, withJitter)
      );

      // With jitter, delays should vary
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);

      // But should be within 25% of base (2000 ± 500)
      delays.forEach((d) => {
        expect(d).toBeGreaterThanOrEqual(1500);
        expect(d).toBeLessThanOrEqual(2500);
      });
    });
  });

  describe("isRetryableError", () => {
    test("returns true for retryable UCPError", () => {
      expect(isRetryableError(new NetworkError("Test"))).toBe(true);
      expect(isRetryableError(new TimeoutError("Test", 1000))).toBe(true);
      expect(isRetryableError(new RateLimitError("Test"))).toBe(true);
    });

    test("returns false for non-retryable UCPError", () => {
      expect(isRetryableError(new ValidationError("Test"))).toBe(false);
      expect(isRetryableError(new AuthError("Test"))).toBe(false);
    });

    test("detects retryable patterns in regular errors", () => {
      expect(isRetryableError(new Error("network error"))).toBe(true);
      expect(isRetryableError(new Error("timeout occurred"))).toBe(true);
      expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
    });

    test("returns false for non-retryable regular errors", () => {
      expect(isRetryableError(new Error("invalid input"))).toBe(false);
    });
  });

  describe("withRetry", () => {
    test("succeeds on first try", async () => {
      let calls = 0;
      const result = await withRetry(async () => {
        calls++;
        return "success";
      });

      expect(result).toBe("success");
      expect(calls).toBe(1);
    });

    test("retries on retryable error", async () => {
      let calls = 0;
      const result = await withRetry(
        async () => {
          calls++;
          if (calls < 3) {
            throw new NetworkError("Temporary failure");
          }
          return "success";
        },
        { maxRetries: 3, initialDelayMs: 10 }
      );

      expect(result).toBe("success");
      expect(calls).toBe(3);
    });

    test("throws after max retries", async () => {
      let calls = 0;
      await expect(
        withRetry(
          async () => {
            calls++;
            throw new NetworkError("Always fails");
          },
          { maxRetries: 2, initialDelayMs: 10 }
        )
      ).rejects.toThrow("Always fails");

      expect(calls).toBe(3); // Initial + 2 retries
    });

    test("does not retry non-retryable errors", async () => {
      let calls = 0;
      await expect(
        withRetry(
          async () => {
            calls++;
            throw new ValidationError("Invalid");
          },
          { maxRetries: 3, initialDelayMs: 10 }
        )
      ).rejects.toThrow("Invalid");

      expect(calls).toBe(1);
    });

    test("calls onRetry callback", async () => {
      const retryAttempts: number[] = [];
      let calls = 0;

      await withRetry(
        async () => {
          calls++;
          if (calls < 3) {
            throw new NetworkError("Fail");
          }
          return "ok";
        },
        {
          maxRetries: 3,
          initialDelayMs: 10,
          onRetry: (attempt) => retryAttempts.push(attempt),
        }
      );

      expect(retryAttempts).toEqual([1, 2]);
    });

    test("respects rate limit retry-after", async () => {
      let calls = 0;
      const start = Date.now();

      await withRetry(
        async () => {
          calls++;
          if (calls < 2) {
            throw new RateLimitError("Rate limited", 50);
          }
          return "ok";
        },
        { maxRetries: 2, initialDelayMs: 10 }
      );

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });
});

describe("Logging", () => {
  describe("createLogger", () => {
    test("logs at correct levels", () => {
      const logs: Array<{ level: string; message: string }> = [];
      const logger = createLogger("Test", {
        minLevel: "debug",
        onLog: (entry) => logs.push({ level: entry.level, message: entry.message }),
      });

      logger.debug("Debug message");
      logger.info("Info message");
      logger.warn("Warn message");
      logger.error("Error message");

      expect(logs.length).toBe(4);
      expect(logs[0].level).toBe("debug");
      expect(logs[1].level).toBe("info");
      expect(logs[2].level).toBe("warn");
      expect(logs[3].level).toBe("error");
    });

    test("respects minimum log level", () => {
      const logs: string[] = [];
      const logger = createLogger("Test", {
        minLevel: "warn",
        onLog: (entry) => logs.push(entry.level),
      });

      logger.debug("Debug");
      logger.info("Info");
      logger.warn("Warn");
      logger.error("Error");

      expect(logs).toEqual(["warn", "error"]);
    });

    test("includes logger name in message", () => {
      let loggedMessage = "";
      const logger = createLogger("MyComponent", {
        onLog: (entry) => {
          loggedMessage = entry.message;
        },
      });

      logger.info("Test message");
      expect(loggedMessage).toContain("[MyComponent]");
      expect(loggedMessage).toContain("Test message");
    });

    test("includes error details", () => {
      let logEntry: unknown;
      const logger = createLogger("Test", {
        onLog: (entry) => {
          logEntry = entry;
        },
      });

      const error = new UCPError("Test error", "TEST_CODE");
      logger.error("Operation failed", error);

      expect((logEntry as { error?: { code: string } }).error?.code).toBe("TEST_CODE");
    });

    test("includes timestamp", () => {
      let timestamp = "";
      const logger = createLogger("Test", {
        onLog: (entry) => {
          timestamp = entry.timestamp;
        },
      });

      const before = new Date().toISOString();
      logger.info("Test");
      const after = new Date().toISOString();

      expect(timestamp >= before).toBe(true);
      expect(timestamp <= after).toBe(true);
    });
  });
});

describe("Recovery Strategies", () => {
  describe("withRecovery", () => {
    test("returns result when no error", async () => {
      const result = await withRecovery(async () => "success", []);
      expect(result).toBe("success");
    });

    test("uses recovery strategy on error", async () => {
      const result = await withRecovery(
        async () => {
          throw new NetworkError("Failed");
        },
        [
          {
            name: "fallback",
            canHandle: () => true,
            recover: () => "recovered",
          },
        ]
      );

      expect(result).toBe("recovered");
    });

    test("tries strategies in order", async () => {
      const tried: string[] = [];

      const result = await withRecovery(
        async () => {
          throw new NetworkError("Failed");
        },
        [
          {
            name: "first",
            canHandle: () => false,
            recover: () => {
              tried.push("first");
              return "first";
            },
          },
          {
            name: "second",
            canHandle: () => true,
            recover: () => {
              tried.push("second");
              return "second";
            },
          },
        ]
      );

      expect(result).toBe("second");
      expect(tried).toEqual(["second"]);
    });

    test("rethrows if no strategy handles", async () => {
      await expect(
        withRecovery(
          async () => {
            throw new ValidationError("Invalid");
          },
          [
            {
              name: "network-only",
              canHandle: (e) => e instanceof NetworkError,
              recover: () => "recovered",
            },
          ]
        )
      ).rejects.toThrow("Invalid");
    });

    test("tries next strategy if recovery fails", async () => {
      const result = await withRecovery(
        async () => {
          throw new NetworkError("Failed");
        },
        [
          {
            name: "failing",
            canHandle: () => true,
            recover: () => {
              throw new Error("Recovery failed");
            },
          },
          {
            name: "working",
            canHandle: () => true,
            recover: () => "success",
          },
        ]
      );

      expect(result).toBe("success");
    });
  });

  describe("fallbackStrategy", () => {
    test("returns fallback value for matching errors", async () => {
      const strategy = fallbackStrategy("default");

      expect(strategy.canHandle(new NetworkError("Test"))).toBe(true);
      expect(strategy.canHandle(new MerchantError("Test", 500))).toBe(true);
      expect(await strategy.recover(new NetworkError("Test"))).toBe("default");
    });

    test("respects error type filter", () => {
      const strategy = fallbackStrategy("default", ["NETWORK_ERROR"]);

      expect(strategy.canHandle(new NetworkError("Test"))).toBe(true);
      expect(strategy.canHandle(new MerchantError("Test", 500))).toBe(false);
    });
  });

  describe("cachedStrategy", () => {
    test("uses cached value when available", async () => {
      let cached: string | undefined = "cached-data";
      const strategy = cachedStrategy(() => cached);

      expect(strategy.canHandle(new NetworkError("Test"))).toBe(true);
      expect(await strategy.recover(new NetworkError("Test"))).toBe("cached-data");
    });

    test("cannot handle when no cache", () => {
      const strategy = cachedStrategy(() => undefined);
      expect(strategy.canHandle(new NetworkError("Test"))).toBe(false);
    });

    test("respects error type filter", () => {
      const strategy = cachedStrategy(() => "cached", ["TIMEOUT_ERROR"]);

      expect(strategy.canHandle(new TimeoutError("Test", 1000))).toBe(true);
      expect(strategy.canHandle(new NetworkError("Test"))).toBe(false);
    });
  });
});
