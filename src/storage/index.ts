import { Database } from "bun:sqlite";
import type { CheckoutSession, Order, UCPDiscoveryResponse } from "../sdk";

// ============================================
// STORAGE INTERFACE
// ============================================

export interface StorageProvider {
  // Session operations
  getSession(id: string): Promise<CheckoutSession | null>;
  setSession(session: CheckoutSession): Promise<void>;
  deleteSession(id: string): Promise<boolean>;
  listSessions(options?: { status?: string; limit?: number }): Promise<CheckoutSession[]>;

  // Order operations
  getOrder(id: string): Promise<Order | null>;
  setOrder(order: Order): Promise<void>;
  deleteOrder(id: string): Promise<boolean>;
  listOrders(options?: {
    customerId?: string;
    status?: string;
    limit?: number;
  }): Promise<Order[]>;

  // Merchant capabilities cache
  getCapabilities(merchantId: string): Promise<UCPDiscoveryResponse | null>;
  setCapabilities(merchantId: string, caps: UCPDiscoveryResponse, ttlMs?: number): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
  clear(): Promise<void>;
}

// ============================================
// IN-MEMORY STORAGE
// ============================================

export class InMemoryStorage implements StorageProvider {
  private sessions = new Map<string, CheckoutSession>();
  private orders = new Map<string, Order>();
  private capabilities = new Map<string, { data: UCPDiscoveryResponse; expiresAt: number }>();

  async getSession(id: string): Promise<CheckoutSession | null> {
    return this.sessions.get(id) || null;
  }

  async setSession(session: CheckoutSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }

  async listSessions(options?: { status?: string; limit?: number }): Promise<CheckoutSession[]> {
    let result = Array.from(this.sessions.values());

    if (options?.status) {
      result = result.filter((s) => s.status === options.status);
    }

    // Sort by creation date, newest first
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (options?.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  async getOrder(id: string): Promise<Order | null> {
    return this.orders.get(id) || null;
  }

  async setOrder(order: Order): Promise<void> {
    this.orders.set(order.id, order);
  }

  async deleteOrder(id: string): Promise<boolean> {
    return this.orders.delete(id);
  }

  async listOrders(options?: {
    customerId?: string;
    status?: string;
    limit?: number;
  }): Promise<Order[]> {
    let result = Array.from(this.orders.values());

    if (options?.customerId) {
      result = result.filter((o) => o.customer.id === options.customerId);
    }

    if (options?.status) {
      result = result.filter((o) => o.status === options.status);
    }

    // Sort by creation date, newest first
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (options?.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  async getCapabilities(merchantId: string): Promise<UCPDiscoveryResponse | null> {
    const entry = this.capabilities.get(merchantId);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.capabilities.delete(merchantId);
      return null;
    }

    return entry.data;
  }

  async setCapabilities(
    merchantId: string,
    caps: UCPDiscoveryResponse,
    ttlMs: number = 5 * 60 * 1000
  ): Promise<void> {
    this.capabilities.set(merchantId, {
      data: caps,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async close(): Promise<void> {
    // No-op for in-memory storage
  }

  async clear(): Promise<void> {
    this.sessions.clear();
    this.orders.clear();
    this.capabilities.clear();
  }
}

// ============================================
// SQLITE STORAGE
// ============================================

export interface SQLiteStorageConfig {
  /** Database file path, or ":memory:" for in-memory */
  path?: string;
  /** Whether to enable WAL mode for better concurrency */
  walMode?: boolean;
}

export class SQLiteStorage implements StorageProvider {
  private db: Database;

  constructor(config: SQLiteStorageConfig = {}) {
    const { path = ":memory:", walMode = true } = config;

    this.db = new Database(path);

    if (walMode && path !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL");
    }

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_merchant ON sessions(merchant_id);

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        customer_id TEXT,
        order_number TEXT UNIQUE,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
      CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id);

      CREATE TABLE IF NOT EXISTS capabilities (
        merchant_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  async getSession(id: string): Promise<CheckoutSession | null> {
    const stmt = this.db.prepare("SELECT data FROM sessions WHERE id = ?");
    const row = stmt.get(id) as { data: string } | null;
    return row ? JSON.parse(row.data) : null;
  }

  async setSession(session: CheckoutSession): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, merchant_id, status, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      session.id,
      session.merchantId,
      session.status,
      JSON.stringify(session),
      session.createdAt,
      session.updatedAt
    );
  }

  async deleteSession(id: string): Promise<boolean> {
    const stmt = this.db.prepare("DELETE FROM sessions WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async listSessions(options?: { status?: string; limit?: number }): Promise<CheckoutSession[]> {
    let sql = "SELECT data FROM sessions";
    const params: unknown[] = [];

    if (options?.status) {
      sql += " WHERE status = ?";
      params.push(options.status);
    }

    sql += " ORDER BY created_at DESC";

    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data));
  }

  async getOrder(id: string): Promise<Order | null> {
    const stmt = this.db.prepare("SELECT data FROM orders WHERE id = ?");
    const row = stmt.get(id) as { data: string } | null;
    return row ? JSON.parse(row.data) : null;
  }

  async setOrder(order: Order): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO orders (id, merchant_id, customer_id, order_number, status, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      order.id,
      order.merchantId,
      order.customer.id || null,
      order.orderNumber,
      order.status,
      JSON.stringify(order),
      order.createdAt,
      order.updatedAt
    );
  }

  async deleteOrder(id: string): Promise<boolean> {
    const stmt = this.db.prepare("DELETE FROM orders WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async listOrders(options?: {
    customerId?: string;
    status?: string;
    limit?: number;
  }): Promise<Order[]> {
    let sql = "SELECT data FROM orders WHERE 1=1";
    const params: unknown[] = [];

    if (options?.customerId) {
      sql += " AND customer_id = ?";
      params.push(options.customerId);
    }

    if (options?.status) {
      sql += " AND status = ?";
      params.push(options.status);
    }

    sql += " ORDER BY created_at DESC";

    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data));
  }

  async getCapabilities(merchantId: string): Promise<UCPDiscoveryResponse | null> {
    const stmt = this.db.prepare(
      "SELECT data FROM capabilities WHERE merchant_id = ? AND expires_at > ?"
    );
    const row = stmt.get(merchantId, Date.now()) as { data: string } | null;
    return row ? JSON.parse(row.data) : null;
  }

  async setCapabilities(
    merchantId: string,
    caps: UCPDiscoveryResponse,
    ttlMs: number = 5 * 60 * 1000
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO capabilities (merchant_id, data, expires_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(merchantId, JSON.stringify(caps), Date.now() + ttlMs);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async clear(): Promise<void> {
    this.db.exec("DELETE FROM sessions");
    this.db.exec("DELETE FROM orders");
    this.db.exec("DELETE FROM capabilities");
  }

  /**
   * Run database vacuum to reclaim space
   */
  vacuum(): void {
    this.db.exec("VACUUM");
  }

  /**
   * Get database statistics
   */
  getStats(): { sessions: number; orders: number; capabilities: number } {
    const sessions = this.db.prepare("SELECT COUNT(*) as count FROM sessions").get() as {
      count: number;
    };
    const orders = this.db.prepare("SELECT COUNT(*) as count FROM orders").get() as {
      count: number;
    };
    const capabilities = this.db.prepare("SELECT COUNT(*) as count FROM capabilities").get() as {
      count: number;
    };

    return {
      sessions: sessions.count,
      orders: orders.count,
      capabilities: capabilities.count,
    };
  }
}

// ============================================
// FACTORY
// ============================================

export type StorageType = "memory" | "sqlite";

export interface StorageConfig {
  type: StorageType;
  sqlite?: SQLiteStorageConfig;
}

export function createStorage(config: StorageConfig = { type: "memory" }): StorageProvider {
  switch (config.type) {
    case "sqlite":
      return new SQLiteStorage(config.sqlite);
    case "memory":
    default:
      return new InMemoryStorage();
  }
}
