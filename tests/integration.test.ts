import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createUCPServer } from "../src/server";

describe("Integration: Full Checkout Flow", () => {
  let server: ReturnType<typeof Bun.serve>;
  const PORT = 3999;
  const BASE_URL = `http://localhost:${PORT}`;

  beforeAll(() => {
    const app = createUCPServer({
      merchantId: "integration-test",
      merchantName: "Integration Test Store",
      port: PORT,
    });
    server = Bun.serve({ port: PORT, fetch: app.fetch });
  });

  afterAll(() => {
    server.stop();
  });

  test("complete checkout flow: discover -> create -> update -> complete", async () => {
    // 1. Discover merchant
    const discovery = await fetch(`${BASE_URL}/.well-known/ucp`);
    expect(discovery.ok).toBe(true);
    const caps = await discovery.json();
    expect(caps.merchantId).toBe("integration-test");

    // 2. Create checkout
    const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: "integration-test",
        cart: {
          items: [
            {
              id: "item-1",
              productId: "prod-1",
              name: "Test Product",
              quantity: 2,
              unitPrice: { amount: "25.00", currency: "USD" },
              totalPrice: { amount: "50.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "50.00", currency: "USD" },
          total: { amount: "50.00", currency: "USD" },
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const session = await createRes.json();
    expect(session.id).toBeDefined();
    expect(session.status).toBe("PENDING");

    // 3. Update with shipping address
    const updateRes = await fetch(`${BASE_URL}/ucp/checkout/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shippingAddress: {
          line1: "123 Test St",
          city: "Test City",
          region: "TS",
          postalCode: "12345",
          country: "US",
        },
      }),
    });
    expect(updateRes.ok).toBe(true);

    // 4. Get shipping options
    const shippingRes = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/shipping-options`);
    expect(shippingRes.ok).toBe(true);
    const { options } = await shippingRes.json();
    expect(options.length).toBeGreaterThan(0);

    // 5. Select shipping
    const selectShipping = await fetch(`${BASE_URL}/ucp/checkout/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedShippingOptionId: options[0].id }),
    });
    expect(selectShipping.ok).toBe(true);

    // 6. Apply discount
    const discountRes = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/discount`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "SAVE10" }),
    });
    expect(discountRes.ok).toBe(true);

    // 7. Complete payment
    const completeRes = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentMethod: { type: "card", token: "tok_test" },
      }),
    });
    expect(completeRes.ok).toBe(true);
    const result = await completeRes.json();
    expect(result.success).toBe(true);
    expect(result.orderId).toBeDefined();
    expect(result.orderNumber).toBeDefined();

    // 8. Get order
    const orderRes = await fetch(`${BASE_URL}/ucp/orders/${result.orderId}`);
    expect(orderRes.ok).toBe(true);
    const order = await orderRes.json();
    expect(order.status).toBe("CONFIRMED");
  });

  test("discount flow: apply and remove", async () => {
    // Create checkout
    const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: "integration-test",
        cart: {
          items: [{ id: "i1", productId: "p1", name: "Item", quantity: 1, unitPrice: { amount: "100.00", currency: "USD" }, totalPrice: { amount: "100.00", currency: "USD" } }],
          subtotal: { amount: "100.00", currency: "USD" },
          total: { amount: "100.00", currency: "USD" },
        },
      }),
    });
    const session = await createRes.json();

    // Apply SAVE20 (20% off)
    const applyRes = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/discount`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "SAVE20" }),
    });
    expect(applyRes.ok).toBe(true);
    const { newTotal, discount } = await applyRes.json();
    expect(newTotal.amount).toBe("80.00"); // 100 - 20%

    // Remove discount
    const removeRes = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/discount/${discount.discountId}`, {
      method: "DELETE",
    });
    expect(removeRes.ok).toBe(true);
    const removeResult = await removeRes.json();
    expect(removeResult.newTotal.amount).toBe("100.00");
  });

  test("error handling: invalid discount code", async () => {
    const createRes = await fetch(`${BASE_URL}/ucp/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: "integration-test",
        cart: {
          items: [{ id: "i1", productId: "p1", name: "Item", quantity: 1, unitPrice: { amount: "10.00", currency: "USD" }, totalPrice: { amount: "10.00", currency: "USD" } }],
          subtotal: { amount: "10.00", currency: "USD" },
          total: { amount: "10.00", currency: "USD" },
        },
      }),
    });
    const session = await createRes.json();

    const discountRes = await fetch(`${BASE_URL}/ucp/checkout/${session.id}/discount`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "INVALID_CODE" }),
    });
    expect(discountRes.status).toBe(400);
  });

  test("error handling: session not found", async () => {
    const res = await fetch(`${BASE_URL}/ucp/checkout/nonexistent-session`);
    expect(res.status).toBe(404);
  });

  test("order management: list and filter", async () => {
    const listRes = await fetch(`${BASE_URL}/ucp/orders?limit=5`);
    expect(listRes.ok).toBe(true);
    const { orders } = await listRes.json();
    expect(Array.isArray(orders)).toBe(true);
  });
});

describe("Integration: Multi-session", () => {
  let server: ReturnType<typeof Bun.serve>;
  const PORT = 3998;
  const BASE_URL = `http://localhost:${PORT}`;

  beforeAll(() => {
    const app = createUCPServer({
      merchantId: "multi-test",
      merchantName: "Multi Session Test",
      port: PORT,
    });
    server = Bun.serve({ port: PORT, fetch: app.fetch });
  });

  afterAll(() => {
    server.stop();
  });

  test("handles multiple concurrent sessions", async () => {
    const createSession = () =>
      fetch(`${BASE_URL}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: "multi-test",
          cart: {
            items: [{ id: "i1", productId: "p1", name: "Item", quantity: 1, unitPrice: { amount: "10.00", currency: "USD" }, totalPrice: { amount: "10.00", currency: "USD" } }],
            subtotal: { amount: "10.00", currency: "USD" },
            total: { amount: "10.00", currency: "USD" },
          },
        }),
      });

    const [s1, s2, s3] = await Promise.all([
      createSession(),
      createSession(),
      createSession(),
    ]);

    expect(s1.status).toBe(201);
    expect(s2.status).toBe(201);
    expect(s3.status).toBe(201);

    const sessions = await Promise.all([s1.json(), s2.json(), s3.json()]);
    const ids = sessions.map((s) => s.id);
    expect(new Set(ids).size).toBe(3); // All unique
  });
});
