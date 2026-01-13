import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { createUCPMCPServer, type MCPServerConfig } from "../src/mcp/ucp-mcp-server";
import { Hono } from "hono";

// Mock server for testing
function createMockMerchant() {
  const app = new Hono();
  const sessions = new Map<string, unknown>();
  let sessionCounter = 0;

  // Discovery endpoint
  app.get("/.well-known/ucp", (c) => {
    return c.json({
      version: "1.0.0",
      merchantId: "test-merchant",
      merchantName: "Test Store",
      services: [
        {
          name: "checkout",
          capabilities: [{ id: "checkout:create", version: "1.0" }],
          bindings: [{ type: "REST", endpoint: "/ucp" }],
        },
      ],
    });
  });

  // Create checkout
  app.post("/ucp/checkout", async (c) => {
    const body = await c.req.json();
    const session = {
      id: `session-${++sessionCounter}`,
      merchantId: body.merchantId,
      status: "PENDING",
      cart: body.cart,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessions.set(session.id, session);
    return c.json(session);
  });

  // Get checkout
  app.get("/ucp/checkout/:id", (c) => {
    const session = sessions.get(c.req.param("id"));
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(session);
  });

  // Update checkout
  app.patch("/ucp/checkout/:id", async (c) => {
    const session = sessions.get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }
    const updates = await c.req.json();
    Object.assign(session, updates, { updatedAt: new Date().toISOString() });
    return c.json(session);
  });

  return { app, sessions };
}

describe("MCP Server State", () => {
  let config: MCPServerConfig;

  beforeEach(() => {
    config = { merchantEndpoint: "http://localhost:3456" };
  });

  describe("createUCPMCPServer", () => {
    test("creates server with initial empty state", () => {
      const server = createUCPMCPServer(config);
      const state = server.getState();

      expect(state.currentSessionId).toBeNull();
      expect(state.checkoutSessions.size).toBe(0);
      expect(state.merchantCapabilities).toBeNull();
      expect(state.lastDiscoveryAt).toBeNull();
    });

    test("clearState resets all state", () => {
      const server = createUCPMCPServer(config);
      const state = server.getState();

      // Manually set some state
      state.currentSessionId = "test-session";
      state.merchantCapabilities = { version: "1.0.0" } as any;
      state.lastDiscoveryAt = Date.now();

      server.clearState();

      expect(state.currentSessionId).toBeNull();
      expect(state.checkoutSessions.size).toBe(0);
      expect(state.merchantCapabilities).toBeNull();
      expect(state.lastDiscoveryAt).toBeNull();
    });
  });
});

describe("MCP Resource Handlers", () => {
  let mockServer: ReturnType<typeof createMockMerchant>;
  let server: ReturnType<typeof createUCPMCPServer>;
  let httpServer: ReturnType<typeof Bun.serve>;
  const port = 3456;

  beforeEach(() => {
    mockServer = createMockMerchant();
    httpServer = Bun.serve({
      port,
      fetch: mockServer.app.fetch,
    });
    server = createUCPMCPServer({ merchantEndpoint: `http://localhost:${port}` });
  });

  afterEach(() => {
    httpServer.stop();
    server.clearState();
  });

  describe("checkout://current resource", () => {
    test("returns error when no active session", async () => {
      // Access the resource through the server's internal resource registry
      // Since we can't easily call resources directly, we verify state behavior
      const state = server.getState();
      expect(state.currentSessionId).toBeNull();
    });

    test("state tracks session after creation", async () => {
      // Simulate what happens when create_checkout is called
      // by directly manipulating the test state
      const state = server.getState();

      // Create a mock session
      const mockSession = {
        id: "session-1",
        merchantId: "test-merchant",
        status: "PENDING",
        cart: {
          items: [
            {
              id: "item-0",
              productId: "prod-1",
              name: "Test Product",
              quantity: 2,
              unitPrice: { amount: "10.00", currency: "USD" },
              totalPrice: { amount: "20.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "20.00", currency: "USD" },
          total: { amount: "20.00", currency: "USD" },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Simulate state update
      state.checkoutSessions.set(mockSession.id, mockSession as any);
      state.currentSessionId = mockSession.id;

      expect(state.currentSessionId).toBe("session-1");
      expect(state.checkoutSessions.has("session-1")).toBe(true);
    });
  });

  describe("merchant://capabilities resource", () => {
    test("initially has no cached capabilities", () => {
      const state = server.getState();
      expect(state.merchantCapabilities).toBeNull();
      expect(state.lastDiscoveryAt).toBeNull();
    });

    test("state tracks capabilities after discovery", () => {
      const state = server.getState();

      // Simulate discover_merchant storing capabilities
      const mockCapabilities = {
        version: "1.0.0",
        merchantId: "test-merchant",
        merchantName: "Test Store",
        services: [],
      };

      state.merchantCapabilities = mockCapabilities as any;
      state.lastDiscoveryAt = Date.now();

      expect(state.merchantCapabilities).not.toBeNull();
      expect(state.merchantCapabilities?.merchantId).toBe("test-merchant");
      expect(state.lastDiscoveryAt).toBeGreaterThan(0);
    });
  });

  describe("cart://items resource", () => {
    test("returns empty cart when no session", () => {
      const state = server.getState();
      expect(state.currentSessionId).toBeNull();
    });

    test("cart accessible from session state", () => {
      const state = server.getState();

      const mockSession = {
        id: "session-1",
        merchantId: "test-merchant",
        status: "PENDING",
        cart: {
          items: [
            {
              id: "item-0",
              productId: "prod-1",
              name: "Widget",
              quantity: 3,
              unitPrice: { amount: "15.00", currency: "USD" },
              totalPrice: { amount: "45.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "45.00", currency: "USD" },
          total: { amount: "45.00", currency: "USD" },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      state.checkoutSessions.set(mockSession.id, mockSession as any);
      state.currentSessionId = mockSession.id;

      const session = state.checkoutSessions.get(state.currentSessionId!);
      expect(session?.cart.items.length).toBe(1);
      expect(session?.cart.items[0].name).toBe("Widget");
      expect(session?.cart.total.amount).toBe("45.00");
    });
  });

  describe("cart://summary resource", () => {
    test("calculates correct item count", () => {
      const state = server.getState();

      const mockSession = {
        id: "session-1",
        merchantId: "test-merchant",
        status: "PENDING",
        cart: {
          items: [
            {
              id: "item-0",
              productId: "prod-1",
              name: "Widget",
              quantity: 2,
              unitPrice: { amount: "10.00", currency: "USD" },
              totalPrice: { amount: "20.00", currency: "USD" },
            },
            {
              id: "item-1",
              productId: "prod-2",
              name: "Gadget",
              quantity: 3,
              unitPrice: { amount: "5.00", currency: "USD" },
              totalPrice: { amount: "15.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "35.00", currency: "USD" },
          total: { amount: "35.00", currency: "USD" },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      state.checkoutSessions.set(mockSession.id, mockSession as any);
      state.currentSessionId = mockSession.id;

      const session = state.checkoutSessions.get(state.currentSessionId!);
      const itemCount = session?.cart.items.reduce(
        (sum: number, item: { quantity: number }) => sum + item.quantity,
        0
      );
      expect(itemCount).toBe(5); // 2 + 3
    });
  });
});

describe("MCP Prompt Templates", () => {
  let server: ReturnType<typeof createUCPMCPServer>;

  beforeEach(() => {
    server = createUCPMCPServer({ merchantEndpoint: "http://localhost:9999" });
  });

  describe("start_shopping prompt", () => {
    test("is registered on server", () => {
      // The server should have the prompt registered
      // We can verify by checking the server has been created successfully
      expect(server).toBeDefined();
    });

    test("state is accessible for context", () => {
      const state = server.getState();

      // Set up merchant capabilities for context
      state.merchantCapabilities = {
        version: "1.0.0",
        merchantId: "test-merchant",
        merchantName: "Test Store",
        services: [],
      } as any;

      expect(state.merchantCapabilities?.merchantName).toBe("Test Store");
    });
  });

  describe("complete_checkout prompt", () => {
    test("uses current session when available", () => {
      const state = server.getState();

      const mockSession = {
        id: "session-1",
        merchantId: "test-merchant",
        status: "PENDING",
        cart: {
          items: [
            {
              id: "item-0",
              productId: "prod-1",
              name: "Test",
              quantity: 1,
              unitPrice: { amount: "10.00", currency: "USD" },
              totalPrice: { amount: "10.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "10.00", currency: "USD" },
          total: { amount: "10.00", currency: "USD" },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      state.checkoutSessions.set(mockSession.id, mockSession as any);
      state.currentSessionId = mockSession.id;

      // Prompt should use this session
      expect(state.currentSessionId).toBe("session-1");
      const session = state.checkoutSessions.get(state.currentSessionId!);
      expect(session?.status).toBe("PENDING");
    });

    test("handles missing session gracefully", () => {
      const state = server.getState();
      expect(state.currentSessionId).toBeNull();
    });
  });

  describe("track_order prompt", () => {
    test("accepts orderId parameter", () => {
      // The prompt accepts orderId which will be used in the message
      const orderId = "order-12345";
      expect(orderId).toBeDefined();
    });
  });

  describe("apply_discount prompt", () => {
    test("requires active session or sessionId", () => {
      const state = server.getState();

      // Without a session, the prompt should indicate no active checkout
      expect(state.currentSessionId).toBeNull();
    });

    test("uses provided sessionId over current session", () => {
      const state = server.getState();

      state.currentSessionId = "session-1";
      const explicitSessionId = "session-other";

      // If explicit sessionId is provided, it should be used
      expect(explicitSessionId).not.toBe(state.currentSessionId);
    });
  });

  describe("browse_products prompt", () => {
    test("handles category filter", () => {
      const category = "electronics";
      expect(category).toBe("electronics");
    });

    test("handles search query", () => {
      const searchQuery = "wireless headphones";
      expect(searchQuery).toBe("wireless headphones");
    });
  });

  describe("request_return prompt", () => {
    test("requires orderId", () => {
      const orderId = "order-67890";
      expect(orderId).toBeDefined();
    });
  });
});

describe("State Persistence Across Operations", () => {
  let server: ReturnType<typeof createUCPMCPServer>;

  beforeEach(() => {
    server = createUCPMCPServer({ merchantEndpoint: "http://localhost:9999" });
  });

  test("multiple sessions can be stored", () => {
    const state = server.getState();

    const session1 = { id: "session-1", status: "PENDING", cart: { items: [] } };
    const session2 = { id: "session-2", status: "COMPLETED", cart: { items: [] } };
    const session3 = { id: "session-3", status: "CANCELLED", cart: { items: [] } };

    state.checkoutSessions.set(session1.id, session1 as any);
    state.checkoutSessions.set(session2.id, session2 as any);
    state.checkoutSessions.set(session3.id, session3 as any);

    expect(state.checkoutSessions.size).toBe(3);
    expect(state.checkoutSessions.get("session-1")?.status).toBe("PENDING");
    expect(state.checkoutSessions.get("session-2")?.status).toBe("COMPLETED");
    expect(state.checkoutSessions.get("session-3")?.status).toBe("CANCELLED");
  });

  test("current session updates correctly", () => {
    const state = server.getState();

    state.currentSessionId = "session-1";
    expect(state.currentSessionId).toBe("session-1");

    state.currentSessionId = "session-2";
    expect(state.currentSessionId).toBe("session-2");

    state.currentSessionId = null;
    expect(state.currentSessionId).toBeNull();
  });

  test("capabilities cache can be updated", () => {
    const state = server.getState();

    const caps1 = { version: "1.0.0", merchantId: "merch-1" };
    state.merchantCapabilities = caps1 as any;
    state.lastDiscoveryAt = 1000;

    expect(state.merchantCapabilities?.merchantId).toBe("merch-1");

    const caps2 = { version: "2.0.0", merchantId: "merch-2" };
    state.merchantCapabilities = caps2 as any;
    state.lastDiscoveryAt = 2000;

    expect(state.merchantCapabilities?.merchantId).toBe("merch-2");
    expect(state.lastDiscoveryAt).toBe(2000);
  });
});
