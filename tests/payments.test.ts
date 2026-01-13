import { describe, expect, test, beforeEach } from "bun:test";
import {
  MockPaymentHandler,
  PaymentHandlerRegistry,
  paymentHandlers,
} from "../src/payments";

describe("MockPaymentHandler", () => {
  let handler: MockPaymentHandler;

  beforeEach(() => {
    handler = new MockPaymentHandler();
    handler.reset();
  });

  describe("getAvailableMethods", () => {
    test("returns default payment methods", async () => {
      const result = await handler.getAvailableMethods();
      expect(result.methods.length).toBeGreaterThan(0);
      expect(result.methods.find((m) => m.type === "card")?.enabled).toBe(true);
    });

    test("returns saved methods for customer", async () => {
      handler.addSavedPaymentMethod("cust-123", {
        id: "pm-1",
        type: "card",
        card: {
          brand: "visa",
          last4: "4242",
          expiryMonth: 12,
          expiryYear: 2025,
        },
        createdAt: new Date().toISOString(),
      });

      const result = await handler.getAvailableMethods("cust-123");
      expect(result.savedMethods?.length).toBe(1);
      expect(result.savedMethods?.[0].card?.last4).toBe("4242");
    });
  });

  describe("createPaymentIntent", () => {
    test("creates pending payment intent", async () => {
      const intent = await handler.createPaymentIntent({
        amount: { amount: "99.99", currency: "USD" },
        checkoutSessionId: "session-123",
        paymentMethodType: "card",
      });

      expect(intent.id).toMatch(/^pi_mock_/);
      expect(intent.status).toBe("pending");
      expect(intent.amount.amount).toBe("99.99");
      expect(intent.clientSecret).toBeDefined();
    });

    test("creates failed payment when shouldFailPayment is true", async () => {
      handler.shouldFailPayment = true;
      handler.failureMessage = "Insufficient funds";

      const intent = await handler.createPaymentIntent({
        amount: { amount: "100.00", currency: "USD" },
        checkoutSessionId: "session-456",
        paymentMethodType: "card",
      });

      expect(intent.status).toBe("failed");
      expect(intent.errorMessage).toBe("Insufficient funds");
    });

    test("creates requires_action when shouldRequireAction is true", async () => {
      handler.shouldRequireAction = true;

      const intent = await handler.createPaymentIntent({
        amount: { amount: "50.00", currency: "EUR" },
        checkoutSessionId: "session-789",
        paymentMethodType: "card",
      });

      expect(intent.status).toBe("requires_action");
    });
  });

  describe("confirmPayment", () => {
    test("confirms payment intent", async () => {
      const created = await handler.createPaymentIntent({
        amount: { amount: "25.00", currency: "USD" },
        checkoutSessionId: "session-1",
        paymentMethodType: "card",
      });

      const confirmed = await handler.confirmPayment({
        paymentIntentId: created.id,
        paymentToken: "tok_test",
      });

      expect(confirmed.status).toBe("authorized");
    });

    test("fails confirmation when shouldFailPayment is set", async () => {
      const created = await handler.createPaymentIntent({
        amount: { amount: "25.00", currency: "USD" },
        checkoutSessionId: "session-2",
        paymentMethodType: "card",
      });

      handler.shouldFailPayment = true;

      const confirmed = await handler.confirmPayment({
        paymentIntentId: created.id,
      });

      expect(confirmed.status).toBe("failed");
    });

    test("throws for non-existent payment intent", async () => {
      await expect(
        handler.confirmPayment({ paymentIntentId: "pi_nonexistent" })
      ).rejects.toThrow("Payment intent not found");
    });
  });

  describe("capturePayment", () => {
    test("captures authorized payment", async () => {
      const created = await handler.createPaymentIntent({
        amount: { amount: "75.00", currency: "USD" },
        checkoutSessionId: "session-3",
        paymentMethodType: "card",
      });

      await handler.confirmPayment({ paymentIntentId: created.id });

      const captured = await handler.capturePayment({
        paymentIntentId: created.id,
      });

      expect(captured.status).toBe("captured");
      expect(captured.capturedAt).toBeDefined();
    });

    test("supports partial capture", async () => {
      const created = await handler.createPaymentIntent({
        amount: { amount: "100.00", currency: "USD" },
        checkoutSessionId: "session-4",
        paymentMethodType: "card",
      });

      await handler.confirmPayment({ paymentIntentId: created.id });

      const captured = await handler.capturePayment({
        paymentIntentId: created.id,
        amount: { amount: "50.00", currency: "USD" },
      });

      expect(captured.status).toBe("captured");
      expect(captured.amount.amount).toBe("50.00");
    });

    test("throws when capturing non-authorized payment", async () => {
      const created = await handler.createPaymentIntent({
        amount: { amount: "30.00", currency: "USD" },
        checkoutSessionId: "session-5",
        paymentMethodType: "card",
      });

      await expect(
        handler.capturePayment({ paymentIntentId: created.id })
      ).rejects.toThrow("Cannot capture payment in status: pending");
    });
  });

  describe("cancelPayment", () => {
    test("cancels pending payment", async () => {
      const created = await handler.createPaymentIntent({
        amount: { amount: "40.00", currency: "USD" },
        checkoutSessionId: "session-6",
        paymentMethodType: "card",
      });

      const cancelled = await handler.cancelPayment(created.id);

      expect(cancelled.status).toBe("cancelled");
    });

    test("throws when cancelling captured payment", async () => {
      const created = await handler.createPaymentIntent({
        amount: { amount: "40.00", currency: "USD" },
        checkoutSessionId: "session-7",
        paymentMethodType: "card",
      });

      await handler.confirmPayment({ paymentIntentId: created.id });
      await handler.capturePayment({ paymentIntentId: created.id });

      await expect(handler.cancelPayment(created.id)).rejects.toThrow(
        "Cannot cancel captured payment"
      );
    });
  });

  describe("refund", () => {
    test("refunds captured payment", async () => {
      const created = await handler.createPaymentIntent({
        amount: { amount: "60.00", currency: "USD" },
        checkoutSessionId: "session-8",
        paymentMethodType: "card",
      });

      await handler.confirmPayment({ paymentIntentId: created.id });
      await handler.capturePayment({ paymentIntentId: created.id });

      const refund = await handler.refund({
        paymentIntentId: created.id,
        reason: "Customer request",
      });

      expect(refund.id).toMatch(/^re_mock_/);
      expect(refund.status).toBe("succeeded");
      expect(refund.amount.amount).toBe("60.00");

      // Check intent status updated
      const intent = await handler.getPaymentIntent(created.id);
      expect(intent.status).toBe("refunded");
    });

    test("supports partial refund", async () => {
      const created = await handler.createPaymentIntent({
        amount: { amount: "100.00", currency: "USD" },
        checkoutSessionId: "session-9",
        paymentMethodType: "card",
      });

      await handler.confirmPayment({ paymentIntentId: created.id });
      await handler.capturePayment({ paymentIntentId: created.id });

      const refund = await handler.refund({
        paymentIntentId: created.id,
        amount: { amount: "30.00", currency: "USD" },
      });

      expect(refund.amount.amount).toBe("30.00");

      const intent = await handler.getPaymentIntent(created.id);
      expect(intent.status).toBe("partially_refunded");
    });

    test("throws when refunding non-captured payment", async () => {
      const created = await handler.createPaymentIntent({
        amount: { amount: "50.00", currency: "USD" },
        checkoutSessionId: "session-10",
        paymentMethodType: "card",
      });

      await expect(
        handler.refund({ paymentIntentId: created.id })
      ).rejects.toThrow("Cannot refund payment in status: pending");
    });
  });

  describe("saved payment methods", () => {
    test("retrieves saved payment methods", async () => {
      handler.addSavedPaymentMethod("cust-456", {
        id: "pm-saved-1",
        type: "card",
        card: {
          brand: "mastercard",
          last4: "5555",
          expiryMonth: 6,
          expiryYear: 2026,
        },
        createdAt: new Date().toISOString(),
      });

      const methods = await handler.getSavedPaymentMethods("cust-456");
      expect(methods.length).toBe(1);
      expect(methods[0].card?.brand).toBe("mastercard");
    });

    test("deletes saved payment method", async () => {
      handler.addSavedPaymentMethod("cust-789", {
        id: "pm-to-delete",
        type: "card",
        card: {
          brand: "amex",
          last4: "0005",
          expiryMonth: 3,
          expiryYear: 2027,
        },
        createdAt: new Date().toISOString(),
      });

      await handler.deletePaymentMethod("pm-to-delete");

      const methods = await handler.getSavedPaymentMethods("cust-789");
      expect(methods.length).toBe(0);
    });
  });

  describe("webhook parsing", () => {
    test("parses valid webhook event", async () => {
      const payload = JSON.stringify({
        type: "payment_intent.succeeded",
        paymentIntentId: "pi_123",
        data: { foo: "bar" },
      });

      const event = await handler.parseWebhookEvent(payload, "valid_sig");

      expect(event).not.toBeNull();
      expect(event?.type).toBe("payment_intent.succeeded");
      expect(event?.paymentIntentId).toBe("pi_123");
    });

    test("returns null for invalid JSON", async () => {
      const event = await handler.parseWebhookEvent("not json", "sig");
      expect(event).toBeNull();
    });
  });
});

describe("PaymentHandlerRegistry", () => {
  test("registers and retrieves handlers", () => {
    const registry = new PaymentHandlerRegistry();
    const mockHandler = new MockPaymentHandler();

    registry.register(mockHandler);

    expect(registry.has("mock")).toBe(true);
    expect(registry.get("mock")).toBe(mockHandler);
  });

  test("sets default handler", () => {
    const registry = new PaymentHandlerRegistry();
    const handler1 = new MockPaymentHandler();
    const handler2 = new MockPaymentHandler();
    (handler2 as { name: string }).name = "mock2";

    registry.register(handler1);
    registry.register(handler2);

    // First registered is default
    expect(registry.getDefault()?.name).toBe("mock");

    registry.setDefault("mock2");
    expect(registry.getDefault()?.name).toBe("mock2");
  });

  test("lists registered handlers", () => {
    const registry = new PaymentHandlerRegistry();
    registry.register(new MockPaymentHandler());

    const list = registry.list();
    expect(list).toContain("mock");
  });

  test("throws when setting non-existent default", () => {
    const registry = new PaymentHandlerRegistry();
    expect(() => registry.setDefault("nonexistent")).toThrow(
      "Payment handler 'nonexistent' not registered"
    );
  });
});
