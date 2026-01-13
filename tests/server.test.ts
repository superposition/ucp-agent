import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createUCPServer } from "../src/server/ucp-server";

const TEST_PORT = 3456;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe("UCP Server", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    const app = createUCPServer({
      merchantId: "test-merchant",
      merchantName: "Test Store",
      port: TEST_PORT,
    });

    server = Bun.serve({
      port: TEST_PORT,
      fetch: app.fetch,
    });
  });

  afterAll(() => {
    server.stop();
  });

  describe("Discovery Endpoint", () => {
    test("GET /.well-known/ucp returns valid discovery response", async () => {
      const response = await fetch(`${BASE_URL}/.well-known/ucp`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.version).toBe("1.0.0");
      expect(data.merchantId).toBe("test-merchant");
      expect(data.merchantName).toBe("Test Store");
      expect(data.services).toBeArray();
      expect(data.services.length).toBeGreaterThan(0);

      // Check that Shopping service exists
      const shoppingService = data.services.find((s: any) => s.name === "Shopping");
      expect(shoppingService).toBeDefined();
      expect(shoppingService.capabilities).toBeArray();

      // Check checkout capability
      const checkoutCap = shoppingService.capabilities.find(
        (c: any) => c.id === "dev.ucp.shopping.checkout"
      );
      expect(checkoutCap).toBeDefined();
    });
  });

  describe("Checkout Endpoints", () => {
    test("POST /ucp/checkout creates a session", async () => {
      const checkoutRequest = {
        merchantId: "test-merchant",
        cart: {
          items: [
            {
              id: "item-1",
              productId: "prod-123",
              name: "Test Product",
              quantity: 2,
              unitPrice: { amount: "10.00", currency: "USD" },
              totalPrice: { amount: "20.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "20.00", currency: "USD" },
          total: { amount: "20.00", currency: "USD" },
        },
      };

      const response = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutRequest),
      });

      expect(response.status).toBe(201);

      const session = await response.json();
      expect(session.id).toBeDefined();
      expect(session.status).toBe("PENDING");
      expect(session.merchantId).toBe("test-merchant");
      expect(session.cart.items).toHaveLength(1);
      expect(session.createdAt).toBeDefined();
    });

    test("GET /ucp/checkout/:sessionId returns session", async () => {
      // First create a session
      const createResponse = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [
              {
                id: "item-1",
                productId: "prod-456",
                name: "Another Product",
                quantity: 1,
                unitPrice: { amount: "15.00", currency: "USD" },
                totalPrice: { amount: "15.00", currency: "USD" },
              },
            ],
            subtotal: { amount: "15.00", currency: "USD" },
            total: { amount: "15.00", currency: "USD" },
          },
        }),
      });

      const createdSession = await createResponse.json();

      // Now fetch it
      const getResponse = await fetch(`${BASE_URL}/ucp/checkout/${createdSession.id}`);
      expect(getResponse.status).toBe(200);

      const session = await getResponse.json();
      expect(session.id).toBe(createdSession.id);
    });

    test("GET /ucp/checkout/:sessionId returns 404 for unknown session", async () => {
      const response = await fetch(`${BASE_URL}/ucp/checkout/nonexistent-id`);
      expect(response.status).toBe(404);
    });

    test("PATCH /ucp/checkout/:sessionId updates session", async () => {
      // Create a session first
      const createResponse = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [
              {
                id: "item-1",
                productId: "prod-789",
                name: "Update Test Product",
                quantity: 1,
                unitPrice: { amount: "25.00", currency: "USD" },
                totalPrice: { amount: "25.00", currency: "USD" },
              },
            ],
            subtotal: { amount: "25.00", currency: "USD" },
            total: { amount: "25.00", currency: "USD" },
          },
        }),
      });

      const createdSession = await createResponse.json();

      // Update with shipping address
      const updateResponse = await fetch(`${BASE_URL}/ucp/checkout/${createdSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shippingAddress: {
            line1: "123 Test St",
            city: "Test City",
            postalCode: "12345",
            country: "US",
          },
        }),
      });

      expect(updateResponse.status).toBe(200);

      const updatedSession = await updateResponse.json();
      expect(updatedSession.shippingAddress).toBeDefined();
      expect(updatedSession.shippingAddress.line1).toBe("123 Test St");
    });

    test("POST /ucp/checkout rejects invalid request", async () => {
      const response = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Missing required fields
          merchantId: "test-merchant",
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("Health Check", () => {
    test("GET /health returns ok", async () => {
      const response = await fetch(`${BASE_URL}/health`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe("ok");
    });
  });
});
