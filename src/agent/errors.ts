// ============================================
// ERROR TYPES
// ============================================

/**
 * Base error class for UCP agent errors
 */
export class UCPError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    retryable: boolean = false,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "UCPError";
    this.code = code;
    this.retryable = retryable;
    this.context = context;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

/**
 * Network-related errors (connection, timeout, etc.)
 */
export class NetworkError extends UCPError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "NETWORK_ERROR", true, context);
    this.name = "NetworkError";
  }
}

/**
 * Merchant unavailable or returning errors
 */
export class MerchantError extends UCPError {
  readonly statusCode?: number;

  constructor(
    message: string,
    statusCode?: number,
    retryable: boolean = false,
    context?: Record<string, unknown>
  ) {
    super(message, "MERCHANT_ERROR", retryable, context);
    this.name = "MerchantError";
    this.statusCode = statusCode;
  }
}

/**
 * Validation errors (invalid input, schema mismatch)
 */
export class ValidationError extends UCPError {
  readonly field?: string;

  constructor(message: string, field?: string, context?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", false, context);
    this.name = "ValidationError";
    this.field = field;
  }
}

/**
 * Authentication/authorization errors
 */
export class AuthError extends UCPError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "AUTH_ERROR", false, context);
    this.name = "AuthError";
  }
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends UCPError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, context?: Record<string, unknown>) {
    super(message, "RATE_LIMIT_ERROR", true, context);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Timeout errors
 */
export class TimeoutError extends UCPError {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, context?: Record<string, unknown>) {
    super(message, "TIMEOUT_ERROR", true, context);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// ============================================
// USER-FRIENDLY MESSAGES
// ============================================

const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  NETWORK_ERROR:
    "I'm having trouble connecting to the merchant. Please check your internet connection and try again.",
  MERCHANT_ERROR:
    "The merchant's service is temporarily unavailable. Please try again in a moment.",
  VALIDATION_ERROR:
    "There was an issue with the information provided. Please check and try again.",
  AUTH_ERROR:
    "There was an authentication issue. Please try again or contact support.",
  RATE_LIMIT_ERROR:
    "We're receiving too many requests. Please wait a moment and try again.",
  TIMEOUT_ERROR:
    "The request took too long. Please try again.",
  UNKNOWN_ERROR:
    "Something unexpected happened. Please try again or contact support.",
};

/**
 * Get a user-friendly error message
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof UCPError) {
    return USER_FRIENDLY_MESSAGES[error.code] || USER_FRIENDLY_MESSAGES.UNKNOWN_ERROR;
  }

  if (error instanceof Error) {
    // Check for common error patterns
    const message = error.message.toLowerCase();
    if (message.includes("fetch") || message.includes("network") || message.includes("econnrefused")) {
      return USER_FRIENDLY_MESSAGES.NETWORK_ERROR;
    }
    if (message.includes("timeout") || message.includes("timed out")) {
      return USER_FRIENDLY_MESSAGES.TIMEOUT_ERROR;
    }
  }

  return USER_FRIENDLY_MESSAGES.UNKNOWN_ERROR;
}

/**
 * Create appropriate UCPError from HTTP response
 */
export async function createErrorFromResponse(
  response: Response,
  context?: Record<string, unknown>
): Promise<UCPError> {
  const status = response.status;
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    body = await response.text().catch(() => null);
  }

  const errorContext = { ...context, status, body };

  // Map HTTP status codes to error types
  if (status === 401 || status === 403) {
    return new AuthError(
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : "Authentication failed",
      errorContext
    );
  }

  if (status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const retryAfterMs = retryAfter ? parseInt(retryAfter) * 1000 : undefined;
    return new RateLimitError("Rate limit exceeded", retryAfterMs, errorContext);
  }

  if (status === 400 || status === 422) {
    return new ValidationError(
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : "Invalid request",
      undefined,
      errorContext
    );
  }

  if (status === 404) {
    return new MerchantError("Resource not found", status, false, errorContext);
  }

  if (status >= 500) {
    return new MerchantError(
      "Merchant service error",
      status,
      true, // Server errors are retryable
      errorContext
    );
  }

  return new MerchantError(
    `Request failed with status ${status}`,
    status,
    status >= 500,
    errorContext
  );
}

/**
 * Create UCPError from caught exception
 */
export function createErrorFromException(
  error: unknown,
  context?: Record<string, unknown>
): UCPError {
  if (error instanceof UCPError) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Detect network errors
    if (
      message.includes("fetch") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("socket")
    ) {
      return new NetworkError(error.message, context);
    }

    // Detect timeout errors
    if (message.includes("timeout") || message.includes("timed out")) {
      return new TimeoutError(error.message, 0, context);
    }

    // Detect abort errors
    if (message.includes("abort") || error.name === "AbortError") {
      return new TimeoutError("Request was aborted", 0, context);
    }
  }

  return new UCPError(
    error instanceof Error ? error.message : String(error),
    "UNKNOWN_ERROR",
    false,
    context
  );
}

// ============================================
// RETRY LOGIC
// ============================================

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Add random jitter to delays */
  jitter: boolean;
  /** Function to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Callback on each retry attempt */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Calculate delay for a retry attempt with exponential backoff
 */
export function calculateRetryDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  let delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);

  // Cap at max delay
  delay = Math.min(delay, config.maxDelayMs);

  // Add jitter (±25%)
  if (config.jitter) {
    const jitterRange = delay * 0.25;
    delay = delay - jitterRange + Math.random() * jitterRange * 2;
  }

  return Math.round(delay);
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof UCPError) {
    return error.retryable;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Network and timeout errors are generally retryable
    return (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("socket")
    );
  }

  return false;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const isRetryable = fullConfig.isRetryable || isRetryableError;

  let lastError: unknown;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= fullConfig.maxRetries || !isRetryable(error)) {
        throw error;
      }

      // Handle rate limit with specific delay
      if (error instanceof RateLimitError && error.retryAfterMs) {
        const delay = error.retryAfterMs;
        fullConfig.onRetry?.(attempt + 1, error, delay);
        await sleep(delay);
        continue;
      }

      // Calculate delay with exponential backoff
      const delay = calculateRetryDelay(attempt, fullConfig);
      fullConfig.onRetry?.(attempt + 1, error, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ============================================
// FETCH WITH RETRY
// ============================================

export interface FetchWithRetryOptions extends RequestInit {
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Retry configuration */
  retry?: Partial<RetryConfig>;
}

/**
 * Fetch with timeout, retry, and error handling
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const { timeoutMs = 30000, retry = {}, ...fetchOptions } = options;

  return withRetry(async () => {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      // Don't retry successful responses
      if (response.ok) {
        return response;
      }

      // Create and throw appropriate error for non-OK responses
      const error = await createErrorFromResponse(response, { url });
      throw error;
    } catch (error) {
      // Convert to UCPError if needed
      if (!(error instanceof UCPError)) {
        throw createErrorFromException(error, { url });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }, retry);
}

// ============================================
// LOGGING
// ============================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
}

/**
 * Create a structured logger
 */
export function createLogger(
  name: string,
  options: {
    minLevel?: LogLevel;
    onLog?: (entry: LogEntry) => void;
  } = {}
): Logger {
  const { minLevel = "info", onLog } = options;

  const levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const shouldLog = (level: LogLevel): boolean => {
    return levels[level] >= levels[minLevel];
  };

  const formatError = (error: unknown) => {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        code: error instanceof UCPError ? error.code : undefined,
        stack: error.stack,
      };
    }
    return { name: "Unknown", message: String(error) };
  };

  const log = (
    level: LogLevel,
    message: string,
    error?: unknown,
    context?: Record<string, unknown>
  ) => {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message: `[${name}] ${message}`,
      timestamp: new Date().toISOString(),
      context,
      error: error ? formatError(error) : undefined,
    };

    if (onLog) {
      onLog(entry);
    } else {
      // Default console output
      const logFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      if (error) {
        logFn(`${entry.timestamp} [${level.toUpperCase()}] ${entry.message}`, error);
      } else if (context) {
        logFn(`${entry.timestamp} [${level.toUpperCase()}] ${entry.message}`, context);
      } else {
        logFn(`${entry.timestamp} [${level.toUpperCase()}] ${entry.message}`);
      }
    }
  };

  return {
    debug: (message, context) => log("debug", message, undefined, context),
    info: (message, context) => log("info", message, undefined, context),
    warn: (message, context) => log("warn", message, undefined, context),
    error: (message, error, context) => log("error", message, error, context),
  };
}

// ============================================
// ERROR RECOVERY STRATEGIES
// ============================================

export interface RecoveryStrategy<T> {
  /** Name of the strategy for logging */
  name: string;
  /** Check if this strategy can handle the error */
  canHandle: (error: unknown) => boolean;
  /** Execute the recovery action */
  recover: (error: unknown) => Promise<T> | T;
}

/**
 * Execute with fallback recovery strategies
 */
export async function withRecovery<T>(
  fn: () => Promise<T>,
  strategies: RecoveryStrategy<T>[],
  logger?: Logger
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // Try each recovery strategy in order
    for (const strategy of strategies) {
      if (strategy.canHandle(error)) {
        logger?.info(`Attempting recovery: ${strategy.name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          return await strategy.recover(error);
        } catch (recoveryError) {
          logger?.warn(`Recovery failed: ${strategy.name}`, {
            error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
          });
          // Continue to next strategy
        }
      }
    }

    // No recovery worked, rethrow original error
    throw error;
  }
}

/**
 * Create a fallback value recovery strategy
 */
export function fallbackStrategy<T>(
  value: T,
  errorTypes: string[] = ["NETWORK_ERROR", "TIMEOUT_ERROR", "MERCHANT_ERROR"]
): RecoveryStrategy<T> {
  return {
    name: "fallback-value",
    canHandle: (error) => {
      if (error instanceof UCPError) {
        return errorTypes.includes(error.code);
      }
      return false;
    },
    recover: () => value,
  };
}

/**
 * Create a cached value recovery strategy
 */
export function cachedStrategy<T>(
  getCache: () => T | undefined,
  errorTypes: string[] = ["NETWORK_ERROR", "TIMEOUT_ERROR"]
): RecoveryStrategy<T> {
  return {
    name: "cached-value",
    canHandle: (error) => {
      if (error instanceof UCPError && errorTypes.includes(error.code)) {
        return getCache() !== undefined;
      }
      return false;
    },
    recover: () => {
      const cached = getCache();
      if (cached === undefined) {
        throw new Error("No cached value available");
      }
      return cached;
    },
  };
}
