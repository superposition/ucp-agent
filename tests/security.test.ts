import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import {
  parseUCPAgent,
  ucpAgentValidator,
  computeSignature,
  verifySignature,
  signatureVerifier,
  createIdempotencyStore,
  idempotencyHandler,
  createRateLimitStore,
  rateLimiter,
  createSecurityMiddleware,
} from "../src/server/security";

describe("UCP-Agent Header Validation", () => {
  describe("parseUCPAgent", () => {
    test("parses valid agent header", () => {
      const result = parseUCPAgent("claude-agent/1.0");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("claude-agent");
      expect(result?.version).toBe("1.0");
    });

    test("parses agent with three-part version", () => {
      const result = parseUCPAgent("mcp-ucp-server/1.2.3");
      expect(result?.name).toBe("mcp-ucp-server");
      expect(result?.version).toBe("1.2.3");
    });

    test("returns null for null input", () => {
      expect(parseUCPAgent(null)).toBeNull();
    });

    test("returns null for invalid format", () => {
      expect(parseUCPAgent("invalid")).toBeNull();
      expect(parseUCPAgent("agent-only")).toBeNull();
      expect(parseUCPAgent("/1.0")).toBeNull();
      expect(parseUCPAgent("agent/")).toBeNull();
      expect(parseUCPAgent("agent/v1.0")).toBeNull();
    });

    test("rejects special characters in name", () => {
      expect(parseUCPAgent("agent@test/1.0")).toBeNull();
      expect(parseUCPAgent("agent.test/1.0")).toBeNull();
    });
  });

  describe("ucpAgentValidator middleware", () => {
    test("allows request without header when not required", async () => {
      const app = new Hono();
      app.use("*", ucpAgentValidator({ required: false }));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(new Request("http://localhost/test"));
      expect(res.status).toBe(200);
    });

    test("rejects request without header when required", async () => {
      const app = new Hono();
      app.use("*", ucpAgentValidator({ required: true }));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(new Request("http://localhost/test"));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("UCP-Agent");
    });

    test("allows request with valid header when required", async () => {
      const app = new Hono();
      app.use("*", ucpAgentValidator({ required: true }));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(
        new Request("http://localhost/test", {
          headers: { "UCP-Agent": "test-agent/1.0" },
        })
      );
      expect(res.status).toBe(200);
    });

    test("rejects non-allowed agents", async () => {
      const app = new Hono();
      app.use(
        "*",
        ucpAgentValidator({ required: true, allowedAgents: ["approved-agent"] })
      );
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(
        new Request("http://localhost/test", {
          headers: { "UCP-Agent": "other-agent/1.0" },
        })
      );
      expect(res.status).toBe(403);
    });

    test("allows approved agents", async () => {
      const app = new Hono();
      app.use(
        "*",
        ucpAgentValidator({ required: true, allowedAgents: ["approved-agent"] })
      );
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(
        new Request("http://localhost/test", {
          headers: { "UCP-Agent": "approved-agent/1.0" },
        })
      );
      expect(res.status).toBe(200);
    });
  });
});

describe("Request Signature Verification", () => {
  const secret = "test-secret-key";

  describe("computeSignature", () => {
    test("computes deterministic signature", async () => {
      const sig1 = await computeSignature('{"test": true}', "1234567890", secret);
      const sig2 = await computeSignature('{"test": true}', "1234567890", secret);
      expect(sig1).toBe(sig2);
    });

    test("different body produces different signature", async () => {
      const sig1 = await computeSignature('{"a": 1}', "1234567890", secret);
      const sig2 = await computeSignature('{"a": 2}', "1234567890", secret);
      expect(sig1).not.toBe(sig2);
    });

    test("different timestamp produces different signature", async () => {
      const sig1 = await computeSignature('{"test": true}', "1234567890", secret);
      const sig2 = await computeSignature('{"test": true}', "1234567891", secret);
      expect(sig1).not.toBe(sig2);
    });
  });

  describe("verifySignature", () => {
    test("verifies valid signature", async () => {
      const body = '{"test": true}';
      const timestamp = "1234567890";
      const signature = await computeSignature(body, timestamp, secret);

      const isValid = await verifySignature(body, timestamp, signature, secret);
      expect(isValid).toBe(true);
    });

    test("rejects invalid signature", async () => {
      const isValid = await verifySignature(
        '{"test": true}',
        "1234567890",
        "invalid-signature",
        secret
      );
      expect(isValid).toBe(false);
    });

    test("rejects tampered body", async () => {
      const signature = await computeSignature('{"test": true}', "1234567890", secret);
      const isValid = await verifySignature(
        '{"test": false}',
        "1234567890",
        signature,
        secret
      );
      expect(isValid).toBe(false);
    });
  });

  describe("signatureVerifier middleware", () => {
    test("skips GET requests", async () => {
      const app = new Hono();
      app.use("*", signatureVerifier({ secret }));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(new Request("http://localhost/test"));
      expect(res.status).toBe(200);
    });

    test("rejects POST without signature headers", async () => {
      const app = new Hono();
      app.use("*", signatureVerifier({ secret }));
      app.post("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(
        new Request("http://localhost/test", {
          method: "POST",
          body: '{"test": true}',
        })
      );
      expect(res.status).toBe(401);
    });

    test("rejects old timestamp", async () => {
      const app = new Hono();
      app.use("*", signatureVerifier({ secret, maxAgeSeconds: 60 }));
      app.post("/test", (c) => c.json({ ok: true }));

      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 120);
      const body = '{"test": true}';
      const signature = await computeSignature(body, oldTimestamp, secret);

      const res = await app.fetch(
        new Request("http://localhost/test", {
          method: "POST",
          body,
          headers: {
            "UCP-Signature": signature,
            "UCP-Timestamp": oldTimestamp,
          },
        })
      );
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain("timestamp");
    });
  });
});

describe("Idempotency Key Handling", () => {
  describe("createIdempotencyStore", () => {
    test("stores and retrieves entries", () => {
      const store = createIdempotencyStore();
      const entry = { response: { ok: true }, status: 200, createdAt: Date.now() };

      store.set("key-1", entry);
      expect(store.has("key-1")).toBe(true);
      expect(store.get("key-1")).toEqual(entry);
    });

    test("returns undefined for missing keys", () => {
      const store = createIdempotencyStore();
      expect(store.get("missing")).toBeUndefined();
      expect(store.has("missing")).toBe(false);
    });

    test("cleans up old entries", () => {
      const store = createIdempotencyStore();
      const oldTime = Date.now() - 1000;
      const newTime = Date.now();

      store.set("old", { response: {}, status: 200, createdAt: oldTime });
      store.set("new", { response: {}, status: 200, createdAt: newTime });

      expect(store.size()).toBe(2);

      // Cleanup entries older than 500ms
      const cleaned = store.cleanup(500);
      expect(cleaned).toBe(1);
      expect(store.size()).toBe(1);
      expect(store.has("old")).toBe(false);
      expect(store.has("new")).toBe(true);
    });
  });

  describe("idempotencyHandler middleware", () => {
    test("skips GET requests", async () => {
      const store = createIdempotencyStore();
      const app = new Hono();
      app.use("*", idempotencyHandler(store));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(new Request("http://localhost/test"));
      expect(res.status).toBe(200);
    });

    test("allows POST without idempotency key when not required", async () => {
      const store = createIdempotencyStore();
      const app = new Hono();
      app.use("*", idempotencyHandler(store, { required: false }));
      app.post("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(
        new Request("http://localhost/test", {
          method: "POST",
          body: "{}",
        })
      );
      expect(res.status).toBe(200);
    });

    test("rejects POST without idempotency key when required", async () => {
      const store = createIdempotencyStore();
      const app = new Hono();
      app.use("*", idempotencyHandler(store, { required: true }));
      app.post("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(
        new Request("http://localhost/test", {
          method: "POST",
          body: "{}",
        })
      );
      expect(res.status).toBe(400);
    });

    test("stores key after first request", async () => {
      const store = createIdempotencyStore();
      const app = new Hono();
      app.use("*", idempotencyHandler(store));
      app.post("/test", (c) => c.json({ ok: true }));

      await app.fetch(
        new Request("http://localhost/test", {
          method: "POST",
          body: "{}",
          headers: { "Idempotency-Key": "test-key-123" },
        })
      );

      expect(store.has("test-key-123")).toBe(true);
    });

    test("returns cached response for duplicate key", async () => {
      const store = createIdempotencyStore();
      store.set("existing-key", {
        response: { cached: true },
        status: 200,
        createdAt: Date.now(),
      });

      const app = new Hono();
      app.use("*", idempotencyHandler(store));
      app.post("/test", (c) => c.json({ fresh: true }));

      const res = await app.fetch(
        new Request("http://localhost/test", {
          method: "POST",
          body: "{}",
          headers: { "Idempotency-Key": "existing-key" },
        })
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Idempotent-Replayed")).toBe("true");
    });
  });
});

describe("Rate Limiting", () => {
  describe("createRateLimitStore", () => {
    test("increments request count", () => {
      const store = createRateLimitStore();
      const windowMs = 60000;

      const entry1 = store.increment("client-1", windowMs);
      expect(entry1.count).toBe(1);

      const entry2 = store.increment("client-1", windowMs);
      expect(entry2.count).toBe(2);
    });

    test("resets after window expires", () => {
      const store = createRateLimitStore();
      const windowMs = 100; // 100ms window

      store.increment("client-1", windowMs);

      // Wait for window to expire
      const start = Date.now();
      while (Date.now() - start < 150) {
        // Busy wait
      }

      const entry = store.increment("client-1", windowMs);
      expect(entry.count).toBe(1);
    });

    test("tracks separate clients", () => {
      const store = createRateLimitStore();
      const windowMs = 60000;

      store.increment("client-1", windowMs);
      store.increment("client-1", windowMs);
      store.increment("client-2", windowMs);

      expect(store.get("client-1")?.count).toBe(2);
      expect(store.get("client-2")?.count).toBe(1);
    });
  });

  describe("rateLimiter middleware", () => {
    test("allows requests under limit", async () => {
      const store = createRateLimitStore();
      const app = new Hono();
      app.use("*", rateLimiter(store, { maxRequests: 10, windowMs: 60000 }));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.fetch(new Request("http://localhost/test"));
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("9");
    });

    test("blocks requests over limit", async () => {
      const store = createRateLimitStore();
      const app = new Hono();
      app.use("*", rateLimiter(store, { maxRequests: 2, windowMs: 60000 }));
      app.get("/test", (c) => c.json({ ok: true }));

      // First two requests should succeed
      await app.fetch(new Request("http://localhost/test"));
      await app.fetch(new Request("http://localhost/test"));

      // Third should be blocked
      const res = await app.fetch(new Request("http://localhost/test"));
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeDefined();
    });

    test("uses custom key generator", async () => {
      const store = createRateLimitStore();
      const app = new Hono();
      app.use(
        "*",
        rateLimiter(store, {
          maxRequests: 1,
          keyGenerator: (c) => c.req.header("X-API-Key") || "anonymous",
        })
      );
      app.get("/test", (c) => c.json({ ok: true }));

      // Different API keys should have separate limits
      const res1 = await app.fetch(
        new Request("http://localhost/test", {
          headers: { "X-API-Key": "key-1" },
        })
      );
      const res2 = await app.fetch(
        new Request("http://localhost/test", {
          headers: { "X-API-Key": "key-2" },
        })
      );

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Same key should be blocked
      const res3 = await app.fetch(
        new Request("http://localhost/test", {
          headers: { "X-API-Key": "key-1" },
        })
      );
      expect(res3.status).toBe(429);
    });
  });
});

describe("Combined Security Middleware", () => {
  test("creates middleware array with rate limiting by default", () => {
    const { middleware, stores } = createSecurityMiddleware();
    expect(middleware.length).toBeGreaterThan(0);
    expect(stores.rateLimit).toBeDefined();
    expect(stores.idempotency).toBeDefined();
  });

  test("includes all configured middleware", () => {
    const { middleware } = createSecurityMiddleware({
      ucpAgent: { required: true },
      idempotency: { required: true },
      rateLimit: { maxRequests: 100 },
    });

    // Should have multiple middleware functions
    expect(middleware.length).toBeGreaterThan(1);
  });

  test("stores are accessible for cleanup", () => {
    const { stores } = createSecurityMiddleware({
      idempotency: {},
      rateLimit: {},
    });

    // Add some data
    stores.idempotency.set("test", {
      response: {},
      status: 200,
      createdAt: Date.now(),
    });
    stores.rateLimit.increment("client", 60000);

    expect(stores.idempotency.size()).toBe(1);

    // Clear stores
    stores.idempotency.clear();
    stores.rateLimit.clear();

    expect(stores.idempotency.size()).toBe(0);
  });
});
