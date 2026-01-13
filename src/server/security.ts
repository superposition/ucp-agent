import type { Context, MiddlewareHandler, Next } from "hono";

// ============================================
// UCP-AGENT HEADER VALIDATION
// ============================================

export interface UCPAgentInfo {
  name: string;
  version: string;
  raw: string;
}

/**
 * Parse and validate UCP-Agent header
 * Format: name/version (e.g., "claude-agent/1.0" or "mcp-ucp-server/1.0")
 */
export function parseUCPAgent(header: string | null): UCPAgentInfo | null {
  if (!header) return null;

  const match = header.match(/^([a-zA-Z0-9-_]+)\/(\d+\.\d+(?:\.\d+)?)$/);
  if (!match) return null;

  return {
    name: match[1],
    version: match[2],
    raw: header,
  };
}

export interface UCPAgentValidatorConfig {
  required?: boolean;
  allowedAgents?: string[];
}

/**
 * Middleware to validate UCP-Agent header
 */
export function ucpAgentValidator(
  config: UCPAgentValidatorConfig = {}
): MiddlewareHandler {
  const { required = false, allowedAgents } = config;

  return async (c: Context, next: Next) => {
    const header = c.req.header("UCP-Agent");
    const agentInfo = parseUCPAgent(header);

    if (required && !agentInfo) {
      return c.json(
        {
          error: "Missing or invalid UCP-Agent header",
          message: "UCP-Agent header is required in format: name/version",
        },
        400
      );
    }

    if (agentInfo && allowedAgents && !allowedAgents.includes(agentInfo.name)) {
      return c.json(
        {
          error: "Unauthorized agent",
          message: `Agent '${agentInfo.name}' is not in the allowed list`,
        },
        403
      );
    }

    // Store parsed agent info for later use
    if (agentInfo) {
      c.set("ucpAgent", agentInfo);
    }

    await next();
  };
}

// ============================================
// REQUEST SIGNATURE VERIFICATION
// ============================================

export interface SignatureConfig {
  secret: string;
  algorithm?: "sha256" | "sha512";
  headerName?: string;
  timestampHeaderName?: string;
  maxAgeSeconds?: number;
}

/**
 * Compute HMAC signature of request body
 */
export async function computeSignature(
  body: string,
  timestamp: string,
  secret: string,
  algorithm: "sha256" | "sha512" = "sha256"
): Promise<string> {
  const data = `${timestamp}.${body}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: algorithm === "sha256" ? "SHA-256" : "SHA-512" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  return Buffer.from(signature).toString("hex");
}

/**
 * Verify request signature
 */
export async function verifySignature(
  body: string,
  timestamp: string,
  signature: string,
  secret: string,
  algorithm: "sha256" | "sha512" = "sha256"
): Promise<boolean> {
  const expected = await computeSignature(body, timestamp, secret, algorithm);

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;

  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Middleware to verify request signatures
 */
export function signatureVerifier(config: SignatureConfig): MiddlewareHandler {
  const {
    secret,
    algorithm = "sha256",
    headerName = "UCP-Signature",
    timestampHeaderName = "UCP-Timestamp",
    maxAgeSeconds = 300, // 5 minutes
  } = config;

  return async (c: Context, next: Next) => {
    // Skip for GET/HEAD/OPTIONS requests (no body)
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      await next();
      return;
    }

    const signature = c.req.header(headerName);
    const timestamp = c.req.header(timestampHeaderName);

    if (!signature || !timestamp) {
      return c.json(
        {
          error: "Missing signature",
          message: `Headers ${headerName} and ${timestampHeaderName} are required`,
        },
        401
      );
    }

    // Check timestamp freshness
    const requestTime = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    const age = Math.abs(now - requestTime);

    if (isNaN(requestTime) || age > maxAgeSeconds) {
      return c.json(
        {
          error: "Invalid timestamp",
          message: "Request timestamp is too old or invalid",
        },
        401
      );
    }

    // Get raw body for signature verification
    const body = await c.req.text();

    // Verify signature
    const isValid = await verifySignature(body, timestamp, signature, secret, algorithm);

    if (!isValid) {
      return c.json(
        {
          error: "Invalid signature",
          message: "Request signature verification failed",
        },
        401
      );
    }

    // Re-parse body as JSON for downstream handlers
    c.set("parsedBody", JSON.parse(body));

    await next();
  };
}

// ============================================
// IDEMPOTENCY KEY HANDLING
// ============================================

export interface IdempotencyConfig {
  headerName?: string;
  storeTtlMs?: number;
  required?: boolean;
}

interface IdempotencyEntry {
  response: unknown;
  status: number;
  createdAt: number;
}

/**
 * Create an in-memory idempotency store
 */
export function createIdempotencyStore() {
  const store = new Map<string, IdempotencyEntry>();

  return {
    get(key: string): IdempotencyEntry | undefined {
      return store.get(key);
    },

    set(key: string, entry: IdempotencyEntry): void {
      store.set(key, entry);
    },

    has(key: string): boolean {
      return store.has(key);
    },

    delete(key: string): boolean {
      return store.delete(key);
    },

    cleanup(maxAgeMs: number): number {
      const now = Date.now();
      let cleaned = 0;

      for (const [key, entry] of store.entries()) {
        if (now - entry.createdAt > maxAgeMs) {
          store.delete(key);
          cleaned++;
        }
      }

      return cleaned;
    },

    size(): number {
      return store.size;
    },

    clear(): void {
      store.clear();
    },
  };
}

export type IdempotencyStore = ReturnType<typeof createIdempotencyStore>;

/**
 * Middleware for idempotency key handling
 */
export function idempotencyHandler(
  store: IdempotencyStore,
  config: IdempotencyConfig = {}
): MiddlewareHandler {
  const {
    headerName = "Idempotency-Key",
    storeTtlMs = 24 * 60 * 60 * 1000, // 24 hours
    required = false,
  } = config;

  return async (c: Context, next: Next) => {
    // Only apply to mutating methods
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      await next();
      return;
    }

    const idempotencyKey = c.req.header(headerName);

    if (!idempotencyKey) {
      if (required) {
        return c.json(
          {
            error: "Missing idempotency key",
            message: `Header ${headerName} is required for this request`,
          },
          400
        );
      }
      await next();
      return;
    }

    // Check for existing response
    const existing = store.get(idempotencyKey);
    if (existing) {
      // Return cached response
      c.header("X-Idempotent-Replayed", "true");
      return c.json(existing.response, existing.status);
    }

    // Process request
    await next();

    // Store response for future replay
    // Note: This requires capturing the response body, which needs special handling
    // For now, we'll just mark that the key was used
    store.set(idempotencyKey, {
      response: { replayed: true },
      status: c.res.status,
      createdAt: Date.now(),
    });

    // Cleanup old entries periodically (1% chance each request)
    if (Math.random() < 0.01) {
      store.cleanup(storeTtlMs);
    }
  };
}

// ============================================
// RATE LIMITING
// ============================================

export interface RateLimitConfig {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (c: Context) => string;
  skipSuccessful?: boolean;
  message?: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Create an in-memory rate limit store
 */
export function createRateLimitStore() {
  const store = new Map<string, RateLimitEntry>();

  return {
    get(key: string): RateLimitEntry | undefined {
      return store.get(key);
    },

    set(key: string, entry: RateLimitEntry): void {
      store.set(key, entry);
    },

    increment(key: string, windowMs: number): RateLimitEntry {
      const now = Date.now();
      const existing = store.get(key);

      if (!existing || now > existing.resetAt) {
        const entry = { count: 1, resetAt: now + windowMs };
        store.set(key, entry);
        return entry;
      }

      existing.count++;
      return existing;
    },

    cleanup(): number {
      const now = Date.now();
      let cleaned = 0;

      for (const [key, entry] of store.entries()) {
        if (now > entry.resetAt) {
          store.delete(key);
          cleaned++;
        }
      }

      return cleaned;
    },

    clear(): void {
      store.clear();
    },
  };
}

export type RateLimitStore = ReturnType<typeof createRateLimitStore>;

/**
 * Middleware for rate limiting
 */
export function rateLimiter(
  store: RateLimitStore,
  config: RateLimitConfig = {}
): MiddlewareHandler {
  const {
    windowMs = 60 * 1000, // 1 minute
    maxRequests = 100,
    keyGenerator = (c) => c.req.header("x-forwarded-for") || c.req.header("cf-connecting-ip") || "unknown",
    message = "Too many requests, please try again later",
  } = config;

  return async (c: Context, next: Next) => {
    const key = keyGenerator(c);
    const entry = store.increment(key, windowMs);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(Math.max(0, maxRequests - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      c.header("Retry-After", String(Math.ceil((entry.resetAt - Date.now()) / 1000)));
      return c.json(
        {
          error: "Rate limit exceeded",
          message,
          retryAfter: Math.ceil((entry.resetAt - Date.now()) / 1000),
        },
        429
      );
    }

    // Cleanup old entries periodically (1% chance each request)
    if (Math.random() < 0.01) {
      store.cleanup();
    }

    await next();
  };
}

// ============================================
// COMBINED SECURITY MIDDLEWARE
// ============================================

export interface SecurityConfig {
  ucpAgent?: UCPAgentValidatorConfig;
  signature?: SignatureConfig;
  idempotency?: IdempotencyConfig;
  rateLimit?: RateLimitConfig;
}

/**
 * Create a combined security middleware configuration
 */
export function createSecurityMiddleware(config: SecurityConfig = {}) {
  const idempotencyStore = createIdempotencyStore();
  const rateLimitStore = createRateLimitStore();

  const middleware: MiddlewareHandler[] = [];

  // Always add rate limiting first
  if (config.rateLimit !== undefined || true) {
    middleware.push(rateLimiter(rateLimitStore, config.rateLimit || {}));
  }

  // UCP-Agent validation
  if (config.ucpAgent) {
    middleware.push(ucpAgentValidator(config.ucpAgent));
  }

  // Signature verification
  if (config.signature) {
    middleware.push(signatureVerifier(config.signature));
  }

  // Idempotency handling
  if (config.idempotency) {
    middleware.push(idempotencyHandler(idempotencyStore, config.idempotency));
  }

  return {
    middleware,
    stores: {
      idempotency: idempotencyStore,
      rateLimit: rateLimitStore,
    },
  };
}
