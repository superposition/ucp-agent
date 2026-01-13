import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import {
  InMemoryStorage,
  SQLiteStorage,
  createStorage,
  type StorageProvider,
} from "../src/storage";
import type { CheckoutSession, Order } from "../src/sdk";

// Test data factories
function createTestSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  const now = new Date().toISOString();
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    merchantId: "test-merchant",
    status: "PENDING",
    cart: {
      items: [
        {
          id: "item-1",
          productId: "prod-1",
          name: "Test Product",
          quantity: 1,
          unitPrice: { amount: "10.00", currency: "USD" },
          totalPrice: { amount: "10.00", currency: "USD" },
        },
      ],
      subtotal: { amount: "10.00", currency: "USD" },
      total: { amount: "10.00", currency: "USD" },
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

let orderCounter = 0;
function createTestOrder(overrides: Partial<Order> = {}): Order {
  const now = new Date().toISOString();
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}-${++orderCounter}`;
  return {
    id: `order-${uniqueId}`,
    merchantId: "test-merchant",
    checkoutSessionId: "session-1",
    orderNumber: `ORD-${uniqueId.toUpperCase()}`,
    status: "CONFIRMED",
    customer: {
      id: "cust-1",
      contact: { name: "Test Customer", email: "test@example.com" },
    },
    lineItems: [
      {
        id: "item-1",
        productId: "prod-1",
        name: "Test Product",
        quantity: 1,
        unitPrice: { amount: "10.00", currency: "USD" },
        totalPrice: { amount: "10.00", currency: "USD" },
        quantityFulfilled: 0,
        quantityCancelled: 0,
      },
    ],
    totals: {
      subtotal: { amount: "10.00", currency: "USD" },
      total: { amount: "10.00", currency: "USD" },
    },
    payments: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Test suite for both storage implementations
function runStorageTests(name: string, createStorageInstance: () => Promise<StorageProvider>) {
  describe(`${name} Storage`, () => {
    let storage: StorageProvider;

    beforeEach(async () => {
      storage = await createStorageInstance();
    });

    afterEach(async () => {
      await storage.clear();
      await storage.close();
    });

    describe("Session Operations", () => {
      test("stores and retrieves session", async () => {
        const session = createTestSession();
        await storage.setSession(session);

        const retrieved = await storage.getSession(session.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.id).toBe(session.id);
        expect(retrieved?.merchantId).toBe(session.merchantId);
        expect(retrieved?.status).toBe(session.status);
      });

      test("returns null for missing session", async () => {
        const result = await storage.getSession("non-existent");
        expect(result).toBeNull();
      });

      test("updates existing session", async () => {
        const session = createTestSession();
        await storage.setSession(session);

        const updated = { ...session, status: "COMPLETED" as const, updatedAt: new Date().toISOString() };
        await storage.setSession(updated);

        const retrieved = await storage.getSession(session.id);
        expect(retrieved?.status).toBe("COMPLETED");
      });

      test("deletes session", async () => {
        const session = createTestSession();
        await storage.setSession(session);

        const deleted = await storage.deleteSession(session.id);
        expect(deleted).toBe(true);

        const retrieved = await storage.getSession(session.id);
        expect(retrieved).toBeNull();
      });

      test("returns false when deleting non-existent session", async () => {
        const deleted = await storage.deleteSession("non-existent");
        expect(deleted).toBe(false);
      });

      test("lists sessions", async () => {
        const session1 = createTestSession({ status: "PENDING" });
        const session2 = createTestSession({ status: "COMPLETED" });
        const session3 = createTestSession({ status: "PENDING" });

        await storage.setSession(session1);
        await storage.setSession(session2);
        await storage.setSession(session3);

        const all = await storage.listSessions();
        expect(all.length).toBe(3);
      });

      test("filters sessions by status", async () => {
        const session1 = createTestSession({ status: "PENDING" });
        const session2 = createTestSession({ status: "COMPLETED" });
        const session3 = createTestSession({ status: "PENDING" });

        await storage.setSession(session1);
        await storage.setSession(session2);
        await storage.setSession(session3);

        const pending = await storage.listSessions({ status: "PENDING" });
        expect(pending.length).toBe(2);
        expect(pending.every((s) => s.status === "PENDING")).toBe(true);
      });

      test("limits session results", async () => {
        for (let i = 0; i < 5; i++) {
          await storage.setSession(createTestSession());
        }

        const limited = await storage.listSessions({ limit: 3 });
        expect(limited.length).toBe(3);
      });
    });

    describe("Order Operations", () => {
      test("stores and retrieves order", async () => {
        const order = createTestOrder();
        await storage.setOrder(order);

        const retrieved = await storage.getOrder(order.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.id).toBe(order.id);
        expect(retrieved?.orderNumber).toBe(order.orderNumber);
        expect(retrieved?.status).toBe(order.status);
      });

      test("returns null for missing order", async () => {
        const result = await storage.getOrder("non-existent");
        expect(result).toBeNull();
      });

      test("updates existing order", async () => {
        const order = createTestOrder();
        await storage.setOrder(order);

        const updated = { ...order, status: "SHIPPED" as const, updatedAt: new Date().toISOString() };
        await storage.setOrder(updated);

        const retrieved = await storage.getOrder(order.id);
        expect(retrieved?.status).toBe("SHIPPED");
      });

      test("deletes order", async () => {
        const order = createTestOrder();
        await storage.setOrder(order);

        const deleted = await storage.deleteOrder(order.id);
        expect(deleted).toBe(true);

        const retrieved = await storage.getOrder(order.id);
        expect(retrieved).toBeNull();
      });

      test("lists orders", async () => {
        const order1 = createTestOrder({ status: "CONFIRMED" });
        const order2 = createTestOrder({ status: "SHIPPED" });
        const order3 = createTestOrder({ status: "CONFIRMED" });

        await storage.setOrder(order1);
        await storage.setOrder(order2);
        await storage.setOrder(order3);

        const all = await storage.listOrders();
        expect(all.length).toBe(3);
      });

      test("filters orders by status", async () => {
        const order1 = createTestOrder({ status: "CONFIRMED" });
        const order2 = createTestOrder({ status: "SHIPPED" });
        const order3 = createTestOrder({ status: "CONFIRMED" });

        await storage.setOrder(order1);
        await storage.setOrder(order2);
        await storage.setOrder(order3);

        const confirmed = await storage.listOrders({ status: "CONFIRMED" });
        expect(confirmed.length).toBe(2);
        expect(confirmed.every((o) => o.status === "CONFIRMED")).toBe(true);
      });

      test("filters orders by customerId", async () => {
        const order1 = createTestOrder({ customer: { id: "cust-1", contact: { name: "A" } } });
        const order2 = createTestOrder({ customer: { id: "cust-2", contact: { name: "B" } } });
        const order3 = createTestOrder({ customer: { id: "cust-1", contact: { name: "A" } } });

        await storage.setOrder(order1);
        await storage.setOrder(order2);
        await storage.setOrder(order3);

        const cust1Orders = await storage.listOrders({ customerId: "cust-1" });
        expect(cust1Orders.length).toBe(2);
      });

      test("limits order results", async () => {
        for (let i = 0; i < 5; i++) {
          await storage.setOrder(createTestOrder());
        }

        const limited = await storage.listOrders({ limit: 2 });
        expect(limited.length).toBe(2);
      });
    });

    describe("Capabilities Cache", () => {
      test("stores and retrieves capabilities", async () => {
        const caps = {
          version: "1.0.0",
          merchantId: "test-merchant",
          merchantName: "Test Store",
          services: [],
        };

        await storage.setCapabilities("test-merchant", caps as any);
        const retrieved = await storage.getCapabilities("test-merchant");

        expect(retrieved).not.toBeNull();
        expect(retrieved?.merchantId).toBe("test-merchant");
        expect(retrieved?.merchantName).toBe("Test Store");
      });

      test("returns null for missing capabilities", async () => {
        const result = await storage.getCapabilities("non-existent");
        expect(result).toBeNull();
      });

      test("expires capabilities after TTL", async () => {
        const caps = {
          version: "1.0.0",
          merchantId: "test-merchant",
          merchantName: "Test Store",
          services: [],
        };

        // Set with very short TTL
        await storage.setCapabilities("test-merchant", caps as any, 50);

        // Should exist immediately
        let retrieved = await storage.getCapabilities("test-merchant");
        expect(retrieved).not.toBeNull();

        // Wait for expiry
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Should be expired
        retrieved = await storage.getCapabilities("test-merchant");
        expect(retrieved).toBeNull();
      });
    });

    describe("Clear Operation", () => {
      test("clears all data", async () => {
        await storage.setSession(createTestSession());
        await storage.setOrder(createTestOrder());
        await storage.setCapabilities("test", { version: "1.0.0" } as any);

        await storage.clear();

        const sessions = await storage.listSessions();
        const orders = await storage.listOrders();
        const caps = await storage.getCapabilities("test");

        expect(sessions.length).toBe(0);
        expect(orders.length).toBe(0);
        expect(caps).toBeNull();
      });
    });
  });
}

// Run tests for InMemoryStorage
runStorageTests("InMemory", async () => new InMemoryStorage());

// Run tests for SQLiteStorage (in-memory mode)
runStorageTests("SQLite (in-memory)", async () => new SQLiteStorage({ path: ":memory:" }));

// SQLite-specific tests
describe("SQLite Storage Specific", () => {
  const testDbPath = "./test-storage.db";
  let storage: SQLiteStorage;

  beforeEach(() => {
    storage = new SQLiteStorage({ path: testDbPath });
  });

  afterEach(async () => {
    await storage.close();
    try {
      await unlink(testDbPath);
      await unlink(`${testDbPath}-wal`).catch(() => {});
      await unlink(`${testDbPath}-shm`).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
  });

  test("persists data to file", async () => {
    const session = createTestSession();
    await storage.setSession(session);
    await storage.close();

    // Reopen database
    const storage2 = new SQLiteStorage({ path: testDbPath });
    const retrieved = await storage2.getSession(session.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(session.id);

    await storage2.close();
  });

  test("getStats returns counts", async () => {
    await storage.setSession(createTestSession());
    await storage.setSession(createTestSession());
    await storage.setOrder(createTestOrder());
    await storage.setCapabilities("test", { version: "1.0.0" } as any);

    const stats = storage.getStats();

    expect(stats.sessions).toBe(2);
    expect(stats.orders).toBe(1);
    expect(stats.capabilities).toBe(1);
  });

  test("vacuum reclaims space", async () => {
    // Add and delete data
    for (let i = 0; i < 10; i++) {
      await storage.setSession(createTestSession());
    }
    await storage.clear();

    // Should not throw
    storage.vacuum();
  });
});

describe("createStorage Factory", () => {
  test("creates InMemoryStorage by default", () => {
    const storage = createStorage();
    expect(storage).toBeInstanceOf(InMemoryStorage);
  });

  test("creates InMemoryStorage when type is memory", () => {
    const storage = createStorage({ type: "memory" });
    expect(storage).toBeInstanceOf(InMemoryStorage);
  });

  test("creates SQLiteStorage when type is sqlite", async () => {
    const storage = createStorage({ type: "sqlite", sqlite: { path: ":memory:" } });
    expect(storage).toBeInstanceOf(SQLiteStorage);
    await storage.close();
  });
});
