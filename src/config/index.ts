import { z } from "zod";

// ============================================
// CONFIGURATION SCHEMA
// ============================================

export const ConfigSchema = z.object({
  // Server settings
  server: z.object({
    port: z.number().default(3000),
    host: z.string().default("localhost"),
  }).default({}),

  // Merchant settings
  merchant: z.object({
    id: z.string().default("default-merchant"),
    name: z.string().default("UCP Merchant"),
    endpoint: z.string().url().optional(),
  }).default({}),

  // Agent settings
  agent: z.object({
    anthropicApiKey: z.string().optional(),
    model: z.string().default("claude-sonnet-4-20250514"),
    maxTokens: z.number().default(4096),
    debug: z.boolean().default(false),
  }).default({}),

  // Storage settings
  storage: z.object({
    type: z.enum(["memory", "sqlite"]).default("memory"),
    sqlitePath: z.string().default("./ucp-data.db"),
  }).default({}),

  // Security settings
  security: z.object({
    enableRateLimit: z.boolean().default(true),
    rateLimitRequests: z.number().default(100),
    rateLimitWindowMs: z.number().default(60000),
    requireUCPAgent: z.boolean().default(false),
    signatureSecret: z.string().optional(),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================
// ENVIRONMENT VARIABLE MAPPING
// ============================================

const ENV_MAPPING: Record<string, string> = {
  PORT: "server.port",
  HOST: "server.host",
  MERCHANT_ID: "merchant.id",
  MERCHANT_NAME: "merchant.name",
  MERCHANT_ENDPOINT: "merchant.endpoint",
  ANTHROPIC_API_KEY: "agent.anthropicApiKey",
  CLAUDE_MODEL: "agent.model",
  DEBUG: "agent.debug",
  STORAGE_TYPE: "storage.type",
  SQLITE_PATH: "storage.sqlitePath",
  RATE_LIMIT_ENABLED: "security.enableRateLimit",
  RATE_LIMIT_REQUESTS: "security.rateLimitRequests",
  SIGNATURE_SECRET: "security.signatureSecret",
};

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

function parseEnvValue(value: string, path: string): unknown {
  // Boolean values
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;

  // Numeric values for known numeric fields
  if (path.includes("port") || path.includes("Requests") || path.includes("WindowMs") || path.includes("maxTokens")) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) return num;
  }

  return value;
}

// ============================================
// CONFIG LOADING
// ============================================

export interface LoadConfigOptions {
  /** Path to config file (.ucprc or ucp.config.json) */
  configPath?: string;
  /** Override values */
  overrides?: Partial<Config>;
  /** Skip loading from environment */
  skipEnv?: boolean;
}

/**
 * Load configuration from environment variables
 */
export function loadFromEnv(): Partial<Config> {
  const config: Record<string, unknown> = {};

  for (const [envKey, configPath] of Object.entries(ENV_MAPPING)) {
    const value = process.env[envKey];
    if (value !== undefined) {
      setNestedValue(config, configPath, parseEnvValue(value, configPath));
    }
  }

  return config as Partial<Config>;
}

/**
 * Load configuration from a JSON file
 */
export async function loadFromFile(path: string): Promise<Partial<Config>> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return {};
    }
    const content = await file.text();
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Deep merge configuration objects
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === "object" &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === "object" &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Load and validate configuration
 * Priority: defaults < config file < environment < overrides
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<Config> {
  // Start with defaults
  let config: Partial<Config> = {};

  // Load from config file
  if (options.configPath) {
    const fileConfig = await loadFromFile(options.configPath);
    config = deepMerge(config as Record<string, unknown>, fileConfig as Record<string, unknown>) as Partial<Config>;
  } else {
    // Try default paths
    for (const path of [".ucprc", "ucp.config.json", ".ucp.json"]) {
      const fileConfig = await loadFromFile(path);
      if (Object.keys(fileConfig).length > 0) {
        config = deepMerge(config as Record<string, unknown>, fileConfig as Record<string, unknown>) as Partial<Config>;
        break;
      }
    }
  }

  // Load from environment
  if (!options.skipEnv) {
    const envConfig = loadFromEnv();
    config = deepMerge(config as Record<string, unknown>, envConfig as Record<string, unknown>) as Partial<Config>;
  }

  // Apply overrides
  if (options.overrides) {
    config = deepMerge(config as Record<string, unknown>, options.overrides as Record<string, unknown>) as Partial<Config>;
  }

  // Validate and apply defaults
  return ConfigSchema.parse(config);
}

/**
 * Get a singleton config instance
 */
let cachedConfig: Config | null = null;

export async function getConfig(options?: LoadConfigOptions): Promise<Config> {
  if (!cachedConfig) {
    cachedConfig = await loadConfig(options);
  }
  return cachedConfig;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}