import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { createUCPServer } from "../src/server/ucp-server";
import { MockPaymentHandler } from "../src/payments";

const TEST_PORT = 3456;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe("UCP Server", () => {
  let server: ReturnType<typeof Bun.serve>;
  let mockPayment: MockPaymentHandler;

  beforeAll(() => {
    mockPayment = new MockPaymentHandler();
    const app = createUCPServer({
      merchantId: "test-merchant",
      merchantName: "Test Store",
      port: TEST_PORT,
      paymentHandler: mockPayment,
    });

    server = Bun.serve({
      port: TEST_PORT,
      fetch: app.fetch,
    });
  });

  beforeEach(() => {
    mockPayment.reset();
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

  describe("Shipping", () => {
    test("GET shipping-options returns options when address set", async () => {
      // Create session
      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [],
            subtotal: { amount: "50.00", currency: "USD" },
            total: { amount: "50.00", currency: "USD" },
          },
        }),
      });
      const session = await createRes.json();

      // Set shipping address
      await fetch(`${BASE_URL}/ucp/checkout/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shippingAddress: {
            line1: "123 Main St",
            city: "Portland",
            region: "OR",
            postalCode: "97201",
            country: "US",
          },
        }),
      });

      // Get shipping options
      const res = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/shipping-options`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.options.length).toBeGreaterThan(0);
      expect(data.options.find((o: { id: string }) => o.id === "standard")).toBeDefined();
    });

    test("GET shipping-options returns 400 without address", async () => {
      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [],
            subtotal: { amount: "50.00", currency: "USD" },
            total: { amount: "50.00", currency: "USD" },
          },
        }),
      });
      const session = await createRes.json();

      const res = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/shipping-options`);
      expect(res.status).toBe(400);
    });

    test("PATCH with shipping option updates cart total", async () => {
      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [],
            subtotal: { amount: "100.00", currency: "USD" },
            total: { amount: "100.00", currency: "USD" },
          },
        }),
      });
      const session = await createRes.json();

      const res = await fetch(`${BASE_URL}/ucp/checkout/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedShippingOptionId: "express" }),
      });

      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.selectedShippingOption.id).toBe("express");
      expect(updated.cart.total.amount).toBe("112.99"); // 100 + 12.99
    });
  });

  describe("Discounts", () => {
    test("POST discount applies valid code", async () => {
      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [],
            subtotal: { amount: "100.00", currency: "USD" },
            total: { amount: "100.00", currency: "USD" },
          },
        }),
      });
      const session = await createRes.json();

      const res = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/discount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "SAVE20" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.discount.name).toBe("20% Off");
      expect(data.newTotal.amount).toBe("80.00");
    });

    test("POST discount rejects invalid code", async () => {
      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [],
            subtotal: { amount: "100.00", currency: "USD" },
            total: { amount: "100.00", currency: "USD" },
          },
        }),
      });
      const session = await createRes.json();

      const res = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/discount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "BADCODE" }),
      });

      expect(res.status).toBe(400);
    });

    test("DELETE discount removes and restores total", async () => {
      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [],
            subtotal: { amount: "100.00", currency: "USD" },
            total: { amount: "100.00", currency: "USD" },
          },
        }),
      });
      const session = await createRes.json();

      // Apply discount (FLAT5 = $5 off, disc-3)
      await fetch(`${BASE_URL}/ucp/checkout/${session.id}/discount`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "FLAT5" }),
      });

      // Remove discount
      const res = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/discount/disc-3`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.newTotal.amount).toBe("100.00");
    });
  });

  describe("Payment", () => {
    test("GET payment-methods returns available methods", async () => {
      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [],
            subtotal: { amount: "50.00", currency: "USD" },
            total: { amount: "50.00", currency: "USD" },
          },
        }),
      });
      const session = await createRes.json();

      const res = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/payment-methods`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.methods.length).toBeGreaterThan(0);
      expect(data.methods.find((m: { type: string }) => m.type === "card")).toBeDefined();
    });

    test("POST complete creates order", async () => {
      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [
              {
                id: "item-pay-1",
                productId: "prod-pay-1",
                name: "Payment Test Item",
                quantity: 1,
                unitPrice: { amount: "30.00", currency: "USD" },
                totalPrice: { amount: "30.00", currency: "USD" },
              },
            ],
            subtotal: { amount: "30.00", currency: "USD" },
            total: { amount: "30.00", currency: "USD" },
          },
          customer: { contact: { name: "Test", email: "test@test.com" } },
        }),
      });
      const session = await createRes.json();

      const res = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: { type: "card" } }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.orderId).toBeDefined();
      expect(data.orderNumber).toMatch(/^ORD-/);
    });

    test("POST complete fails when payment fails", async () => {
      mockPayment.shouldFailPayment = true;

      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [],
            subtotal: { amount: "30.00", currency: "USD" },
            total: { amount: "30.00", currency: "USD" },
          },
        }),
      });
      const session = await createRes.json();

      const res = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: { type: "card" } }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Payment failed");
    });
  });

  describe("Orders", () => {
    async function createTestOrder(): Promise<string> {
      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [
              {
                id: "order-item-1",
                productId: "prod-order-1",
                name: "Order Test Product",
                quantity: 2,
                unitPrice: { amount: "20.00", currency: "USD" },
                totalPrice: { amount: "40.00", currency: "USD" },
              },
            ],
            subtotal: { amount: "40.00", currency: "USD" },
            total: { amount: "40.00", currency: "USD" },
          },
          customer: { id: "test-cust-1", contact: { name: "Order Tester" } },
        }),
      });
      const session = await createRes.json();

      const completeRes = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: { type: "card" } }),
      });
      const data = await completeRes.json();
      return data.orderId;
    }

    test("GET /ucp/orders lists orders", async () => {
      await createTestOrder();

      const res = await fetch(`${BASE_URL}/ucp/orders`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.orders.length).toBeGreaterThan(0);
      expect(data.total).toBeGreaterThan(0);
    });

    test("GET /ucp/orders filters by status", async () => {
      await createTestOrder();

      const res = await fetch(`${BASE_URL}/ucp/orders?status=CONFIRMED`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.orders.every((o: { status: string }) => o.status === "CONFIRMED")).toBe(true);
    });

    test("GET /ucp/orders/:orderId returns order", async () => {
      const orderId = await createTestOrder();

      const res = await fetch(`${BASE_URL}/ucp/orders/${orderId}`);
      expect(res.status).toBe(200);
      const order = await res.json();
      expect(order.id).toBe(orderId);
      expect(order.status).toBe("CONFIRMED");
    });

    test("GET /ucp/orders/:orderId returns 404 for unknown", async () => {
      const res = await fetch(`${BASE_URL}/ucp/orders/unknown-order-id`);
      expect(res.status).toBe(404);
    });

    test("GET /ucp/orders/:orderId/status returns status info", async () => {
      const orderId = await createTestOrder();

      const res = await fetch(`${BASE_URL}/ucp/orders/${orderId}/status`);
      expect(res.status).toBe(200);
      const status = await res.json();
      expect(status.orderId).toBe(orderId);
      expect(status.status).toBe("CONFIRMED");
      expect(status.lineItems.length).toBe(1);
    });

    test("PATCH /ucp/orders/:orderId updates order", async () => {
      const orderId = await createTestOrder();

      const res = await fetch(`${BASE_URL}/ucp/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PROCESSING" }),
      });

      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.status).toBe("PROCESSING");
    });

    test("PATCH sets cancelledAt when cancelling", async () => {
      const orderId = await createTestOrder();

      const res = await fetch(`${BASE_URL}/ucp/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });

      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.cancelledAt).toBeDefined();
    });

    test("PATCH sets completedAt when delivered", async () => {
      const orderId = await createTestOrder();

      const res = await fetch(`${BASE_URL}/ucp/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DELIVERED" }),
      });

      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.completedAt).toBeDefined();
    });
  });

  describe("Returns", () => {
    async function createDeliveredOrder(): Promise<string> {
      const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "test-merchant",
          cart: {
            items: [
              {
                id: "return-item-1",
                productId: "prod-return-1",
                name: "Returnable Product",
                quantity: 1,
                unitPrice: { amount: "50.00", currency: "USD" },
                totalPrice: { amount: "50.00", currency: "USD" },
              },
            ],
            subtotal: { amount: "50.00", currency: "USD" },
            total: { amount: "50.00", currency: "USD" },
          },
        }),
      });
      const session = await createRes.json();

      const completeRes = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: { type: "card" } }),
      });
      const data = await completeRes.json();
      return data.orderId;
    }

    test("POST /ucp/orders/:orderId/returns creates return request", async () => {
      const orderId = await createDeliveredOrder();

      const res = await fetch(`${BASE_URL}/ucp/orders/${orderId}/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ itemId: "return-item-1", quantity: 1 }],
          reason: "DEFECTIVE",
          reasonDetails: "Arrived broken",
        }),
      });

      expect(res.status).toBe(201);
      const returnReq = await res.json();
      expect(returnReq.id).toBeDefined();
      expect(returnReq.status).toBe("REQUESTED");
      expect(returnReq.reason).toBe("DEFECTIVE");
    });

    test("POST returns 404 for non-existent order", async () => {
      const res = await fetch(`${BASE_URL}/ucp/orders/fake-id/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [], reason: "WRONG_ITEM" }),
      });

      expect(res.status).toBe(404);
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
