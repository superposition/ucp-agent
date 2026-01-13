import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  type UCPDiscoveryResponse,
  type CheckoutSession,
  type CreateCheckoutRequest,
  type Order,
  type ShippingOption,
  type AppliedDiscount,
  CreateCheckoutRequestSchema,
} from "../sdk";
import { type PaymentHandler, MockPaymentHandler } from "../payments";

export interface UCPServerConfig {
  merchantId: string;
  merchantName: string;
  port?: number;
  paymentHandler?: PaymentHandler;
}

// Sample shipping options
const SHIPPING_OPTIONS: ShippingOption[] = [
  {
    id: "standard",
    name: "Standard Shipping",
    description: "5-7 business days",
    price: { amount: "5.99", currency: "USD" },
    estimatedDelivery: "5-7 business days",
    carrier: "USPS",
  },
  {
    id: "express",
    name: "Express Shipping",
    description: "2-3 business days",
    price: { amount: "12.99", currency: "USD" },
    estimatedDelivery: "2-3 business days",
    carrier: "UPS",
  },
  {
    id: "overnight",
    name: "Overnight Shipping",
    description: "Next business day",
    price: { amount: "24.99", currency: "USD" },
    estimatedDelivery: "Next business day",
    carrier: "FedEx",
  },
];

// Sample discount codes
const DISCOUNT_CODES: Record<string, { id: string; name: string; type: "PERCENTAGE" | "FIXED_AMOUNT"; value: number }> = {
  SAVE10: { id: "disc-1", name: "10% Off", type: "PERCENTAGE", value: 10 },
  SAVE20: { id: "disc-2", name: "20% Off", type: "PERCENTAGE", value: 20 },
  FLAT5: { id: "disc-3", name: "$5 Off", type: "FIXED_AMOUNT", value: 5 },
  WELCOME: { id: "disc-4", name: "Welcome Discount", type: "PERCENTAGE", value: 15 },
};

export function createUCPServer(config: UCPServerConfig) {
  const app = new Hono();

  // In-memory stores (replace with DB in production)
  const sessions = new Map<string, CheckoutSession>();
  const orders = new Map<string, Order>();
  const appliedDiscounts = new Map<string, AppliedDiscount[]>();

  // Payment handler (default to mock for testing)
  const paymentHandler = config.paymentHandler || new MockPaymentHandler();

  app.use("*", cors());

  // ============================================
  // DISCOVERY
  // ============================================

  app.get("/.well-known/ucp", (c) => {
    const discovery: UCPDiscoveryResponse = {
      version: "1.0.0",
      merchantId: config.merchantId,
      merchantName: config.merchantName,
      services: [
        {
          name: "Shopping",
          capabilities: [
            {
              id: "dev.ucp.shopping.checkout",
              version: "1.0.0",
              extensions: ["discount", "fulfillment"],
            },
            {
              id: "dev.ucp.shopping.orders",
              version: "1.0.0",
            },
          ],
          bindings: [
            {
              type: "REST",
              endpoint: `http://localhost:${config.port || 3000}/ucp`,
            },
            {
              type: "MCP",
              endpoint: `http://localhost:${config.port || 3000}/mcp`,
            },
          ],
        },
      ],
      paymentHandlers: [
        {
          id: "stripe",
          name: "Stripe",
          type: "STRIPE",
          supportedMethods: ["card", "apple_pay", "google_pay"],
        },
      ],
      supportedCurrencies: ["USD", "EUR", "GBP"],
      supportedCountries: ["US", "GB", "DE", "FR"],
    };
    return c.json(discovery);
  });

  // ============================================
  // CHECKOUT
  // ============================================

  app.post("/ucp/checkout", async (c) => {
    const body = await c.req.json();
    const parsed = CreateCheckoutRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error }, 400);
    }

    const request = parsed.data;
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const session: CheckoutSession = {
      id: sessionId,
      merchantId: config.merchantId,
      status: "PENDING",
      cart: request.cart,
      customer: request.customer,
      availableShippingOptions: SHIPPING_OPTIONS,
      createdAt: now,
      updatedAt: now,
      metadata: request.metadata,
    };

    sessions.set(sessionId, session);
    return c.json(session, 201);
  });

  app.get("/ucp/checkout/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.get(sessionId);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json(session);
  });

  app.patch("/ucp/checkout/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.get(sessionId);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const updates = await c.req.json();

    // Handle shipping option selection
    if (updates.selectedShippingOptionId) {
      const shippingOption = SHIPPING_OPTIONS.find(
        (o) => o.id === updates.selectedShippingOptionId
      );
      if (shippingOption) {
        updates.selectedShippingOption = shippingOption;
        // Update cart total with shipping
        const subtotal = parseFloat(session.cart.total.amount);
        const shipping = parseFloat(shippingOption.price.amount);
        updates.cart = {
          ...session.cart,
          shipping: shippingOption.price,
          total: {
            amount: (subtotal + shipping).toFixed(2),
            currency: session.cart.total.currency,
          },
        };
      }
      delete updates.selectedShippingOptionId;
    }

    const updatedSession: CheckoutSession = {
      ...session,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    sessions.set(sessionId, updatedSession);
    return c.json(updatedSession);
  });

  // ============================================
  // SHIPPING
  // ============================================

  app.get("/ucp/checkout/:sessionId/shipping-options", (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.get(sessionId);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    if (!session.shippingAddress) {
      return c.json({ error: "Shipping address required" }, 400);
    }

    return c.json({ options: SHIPPING_OPTIONS });
  });

  // ============================================
  // DISCOUNTS
  // ============================================

  app.post("/ucp/checkout/:sessionId/discount", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.get(sessionId);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const { code } = await c.req.json();
    const discount = DISCOUNT_CODES[code?.toUpperCase()];

    if (!discount) {
      return c.json({ error: "Invalid discount code" }, 400);
    }

    // Check if already applied
    const existing = appliedDiscounts.get(sessionId) || [];
    if (existing.find((d) => d.discountId === discount.id)) {
      return c.json({ error: "Discount already applied" }, 400);
    }

    // Calculate discount amount
    const subtotal = parseFloat(session.cart.subtotal.amount);
    let discountAmount: number;

    if (discount.type === "PERCENTAGE") {
      discountAmount = subtotal * (discount.value / 100);
    } else {
      discountAmount = Math.min(discount.value, subtotal);
    }

    const applied: AppliedDiscount = {
      discountId: discount.id,
      code,
      name: discount.name,
      type: discount.type,
      scope: "ORDER",
      amount: {
        amount: discountAmount.toFixed(2),
        currency: session.cart.total.currency,
      },
    };

    existing.push(applied);
    appliedDiscounts.set(sessionId, existing);

    // Update cart total
    const currentTotal = parseFloat(session.cart.total.amount);
    const newTotal = Math.max(0, currentTotal - discountAmount);

    const updatedSession: CheckoutSession = {
      ...session,
      cart: {
        ...session.cart,
        discount: {
          amount: discountAmount.toFixed(2),
          currency: session.cart.total.currency,
        },
        total: {
          amount: newTotal.toFixed(2),
          currency: session.cart.total.currency,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    sessions.set(sessionId, updatedSession);

    return c.json({
      success: true,
      discount: applied,
      newTotal: updatedSession.cart.total,
    });
  });

  app.delete("/ucp/checkout/:sessionId/discount/:discountId", (c) => {
    const sessionId = c.req.param("sessionId");
    const discountId = c.req.param("discountId");
    const session = sessions.get(sessionId);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const existing = appliedDiscounts.get(sessionId) || [];
    const discount = existing.find((d) => d.discountId === discountId);

    if (!discount) {
      return c.json({ error: "Discount not found" }, 404);
    }

    // Remove discount
    appliedDiscounts.set(
      sessionId,
      existing.filter((d) => d.discountId !== discountId)
    );

    // Recalculate total
    const discountAmount = parseFloat(discount.amount.amount);
    const currentTotal = parseFloat(session.cart.total.amount);

    const updatedSession: CheckoutSession = {
      ...session,
      cart: {
        ...session.cart,
        discount: undefined,
        total: {
          amount: (currentTotal + discountAmount).toFixed(2),
          currency: session.cart.total.currency,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    sessions.set(sessionId, updatedSession);

    return c.json({ success: true, newTotal: updatedSession.cart.total });
  });

  // ============================================
  // PAYMENT
  // ============================================

  app.get("/ucp/checkout/:sessionId/payment-methods", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.get(sessionId);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const methods = await paymentHandler.getAvailableMethods(
      session.customer?.id
    );
    return c.json(methods);
  });

  app.post("/ucp/checkout/:sessionId/complete", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.get(sessionId);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    if (session.status === "COMPLETED") {
      return c.json({ error: "Checkout already completed" }, 400);
    }

    const { paymentMethod, savePaymentMethod } = await c.req.json();

    try {
      // Create payment intent
      const intent = await paymentHandler.createPaymentIntent({
        amount: session.cart.total,
        checkoutSessionId: sessionId,
        customerId: session.customer?.id,
        customerEmail: session.customer?.contact.email,
        paymentMethodType: paymentMethod?.type || "card",
      });

      // Confirm payment
      const confirmed = await paymentHandler.confirmPayment({
        paymentIntentId: intent.id,
        paymentToken: paymentMethod?.token,
        savePaymentMethod,
      });

      if (confirmed.status === "failed") {
        return c.json(
          {
            error: "Payment failed",
            message: confirmed.errorMessage,
          },
          400
        );
      }

      // Capture payment
      const captured = await paymentHandler.capturePayment({
        paymentIntentId: intent.id,
      });

      // Create order
      const orderId = crypto.randomUUID();
      const now = new Date().toISOString();

      const order: Order = {
        id: orderId,
        merchantId: config.merchantId,
        checkoutSessionId: sessionId,
        orderNumber: `ORD-${Date.now().toString(36).toUpperCase()}`,
        status: "CONFIRMED",
        customer: {
          id: session.customer?.id,
          contact: session.customer?.contact || { name: "Guest" },
        },
        shippingAddress: session.shippingAddress,
        billingAddress: session.billingAddress || session.shippingAddress,
        lineItems: session.cart.items.map((item) => ({
          ...item,
          quantityFulfilled: 0,
          quantityCancelled: 0,
        })),
        totals: {
          subtotal: session.cart.subtotal,
          tax: session.cart.tax,
          shipping: session.cart.shipping,
          discount: session.cart.discount,
          total: session.cart.total,
          amountPaid: session.cart.total,
        },
        payments: [
          {
            id: captured.id,
            method: {
              type: paymentMethod?.type || "card",
              provider: paymentHandler.name,
            },
            amount: session.cart.total,
            status: "CAPTURED",
            transactionId: captured.id,
            capturedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
        confirmedAt: now,
      };

      orders.set(orderId, order);

      // Update session status
      session.status = "COMPLETED";
      session.updatedAt = now;
      sessions.set(sessionId, session);

      return c.json({
        success: true,
        orderId,
        orderNumber: order.orderNumber,
        order,
      });
    } catch (error) {
      return c.json(
        {
          error: "Payment processing failed",
          message: String(error),
        },
        500
      );
    }
  });

  // ============================================
  // ORDERS
  // ============================================

  app.get("/ucp/orders", (c) => {
    const customerId = c.req.query("customerId");
    const status = c.req.query("status");
    const limit = parseInt(c.req.query("limit") || "20");

    let orderList = Array.from(orders.values());

    if (customerId) {
      orderList = orderList.filter((o) => o.customer.id === customerId);
    }

    if (status) {
      orderList = orderList.filter((o) => o.status === status);
    }

    // Sort by creation date, newest first
    orderList.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return c.json({
      orders: orderList.slice(0, limit),
      total: orderList.length,
    });
  });

  app.get("/ucp/orders/:orderId", (c) => {
    const orderId = c.req.param("orderId");
    const order = orders.get(orderId);

    if (!order) {
      return c.json({ error: "Order not found" }, 404);
    }

    return c.json(order);
  });

  app.get("/ucp/orders/:orderId/status", (c) => {
    const orderId = c.req.param("orderId");
    const order = orders.get(orderId);

    if (!order) {
      return c.json({ error: "Order not found" }, 404);
    }

    return c.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      createdAt: order.createdAt,
      confirmedAt: order.confirmedAt,
      completedAt: order.completedAt,
      lineItems: order.lineItems.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        quantityFulfilled: item.quantityFulfilled,
        quantityCancelled: item.quantityCancelled,
      })),
    });
  });

  app.patch("/ucp/orders/:orderId", async (c) => {
    const orderId = c.req.param("orderId");
    const order = orders.get(orderId);

    if (!order) {
      return c.json({ error: "Order not found" }, 404);
    }

    const updates = await c.req.json();
    const now = new Date().toISOString();

    const updatedOrder: Order = {
      ...order,
      ...updates,
      updatedAt: now,
    };

    // Handle status transitions
    if (updates.status === "CANCELLED" && !order.cancelledAt) {
      updatedOrder.cancelledAt = now;
    }
    if (updates.status === "DELIVERED" && !order.completedAt) {
      updatedOrder.completedAt = now;
    }

    orders.set(orderId, updatedOrder);
    return c.json(updatedOrder);
  });

  // ============================================
  // RETURNS
  // ============================================

  app.post("/ucp/orders/:orderId/returns", async (c) => {
    const orderId = c.req.param("orderId");
    const order = orders.get(orderId);

    if (!order) {
      return c.json({ error: "Order not found" }, 404);
    }

    if (!["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"].includes(order.status)) {
      return c.json({ error: "Order cannot be returned in current status" }, 400);
    }

    const { items, reason, reasonDetails } = await c.req.json();
    const now = new Date().toISOString();

    const returnRequest = {
      id: crypto.randomUUID(),
      orderId,
      status: "REQUESTED",
      reason,
      reasonDetails,
      items,
      createdAt: now,
    };

    return c.json(returnRequest, 201);
  });

  // ============================================
  // HEALTH
  // ============================================

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}
