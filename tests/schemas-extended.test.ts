import { describe, expect, test } from "bun:test";
import {
  // Order schemas
  OrderSchema,
  OrderStatusSchema,
  OrderLineItemSchema,
  CreateOrderRequestSchema,

  // Fulfillment schemas
  ShipmentSchema,
  ShipmentStatusSchema,
  TrackingSchema,
  ReturnRequestSchema,
  CreateShipmentRequestSchema,

  // Discount schemas
  DiscountSchema,
  DiscountTypeSchema,
  ApplyDiscountRequestSchema,
  ValidateDiscountRequestSchema,

  // Identity schemas
  OAuth2TokenResponseSchema,
  LinkedIdentitySchema,
  IdentityLinkRequestSchema,
  AuthorizationRequestSchema,

  // Webhook schemas
  WebhookEventTypeSchema,
  WebhookEndpointSchema,
} from "../src/sdk";

describe("Order Schemas", () => {
  test("validates order status enum", () => {
    expect(OrderStatusSchema.safeParse("PENDING").success).toBe(true);
    expect(OrderStatusSchema.safeParse("SHIPPED").success).toBe(true);
    expect(OrderStatusSchema.safeParse("INVALID").success).toBe(false);
  });

  test("validates order line item", () => {
    const result = OrderLineItemSchema.safeParse({
      id: "item-1",
      productId: "prod-123",
      name: "Test Product",
      quantity: 2,
      quantityFulfilled: 1,
      quantityCancelled: 0,
      unitPrice: { amount: "10.00", currency: "USD" },
      totalPrice: { amount: "20.00", currency: "USD" },
    });
    expect(result.success).toBe(true);
  });

  test("validates full order", () => {
    const result = OrderSchema.safeParse({
      id: "order-123",
      merchantId: "merchant-1",
      status: "CONFIRMED",
      customer: {
        id: "cust-1",
        contact: { name: "John Doe", email: "john@example.com" },
      },
      lineItems: [
        {
          id: "item-1",
          productId: "prod-1",
          name: "Widget",
          quantity: 1,
          unitPrice: { amount: "25.00", currency: "USD" },
          totalPrice: { amount: "25.00", currency: "USD" },
        },
      ],
      totals: {
        subtotal: { amount: "25.00", currency: "USD" },
        total: { amount: "25.00", currency: "USD" },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  test("validates create order request", () => {
    const result = CreateOrderRequestSchema.safeParse({
      checkoutSessionId: "session-123",
      notes: "Gift wrap please",
    });
    expect(result.success).toBe(true);
  });
});

describe("Fulfillment Schemas", () => {
  test("validates shipment status", () => {
    expect(ShipmentStatusSchema.safeParse("IN_TRANSIT").success).toBe(true);
    expect(ShipmentStatusSchema.safeParse("DELIVERED").success).toBe(true);
    expect(ShipmentStatusSchema.safeParse("FLYING").success).toBe(false);
  });

  test("validates tracking info", () => {
    const result = TrackingSchema.safeParse({
      carrier: "UPS",
      carrierCode: "ups",
      trackingNumber: "1Z999AA10123456784",
      trackingUrl: "https://ups.com/track/1Z999AA10123456784",
      events: [
        {
          timestamp: new Date().toISOString(),
          status: "IN_TRANSIT",
          description: "Package in transit",
          location: "Memphis, TN",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("validates shipment", () => {
    const result = ShipmentSchema.safeParse({
      id: "ship-123",
      orderId: "order-456",
      status: "IN_TRANSIT",
      items: [{ lineItemId: "item-1", quantity: 2 }],
      shippingAddress: {
        line1: "123 Main St",
        city: "San Francisco",
        postalCode: "94102",
        country: "US",
      },
      tracking: {
        carrier: "FedEx",
        trackingNumber: "794644790128",
      },
      createdAt: new Date().toISOString(),
      shippedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  test("validates return request", () => {
    const result = ReturnRequestSchema.safeParse({
      id: "return-123",
      orderId: "order-456",
      status: "REQUESTED",
      reason: "DEFECTIVE",
      reasonDetails: "Screen has dead pixels",
      items: [{ lineItemId: "item-1", quantity: 1 }],
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  test("validates create shipment request", () => {
    const result = CreateShipmentRequestSchema.safeParse({
      orderId: "order-123",
      items: [{ lineItemId: "item-1", quantity: 1 }],
      shippingMethod: "express",
    });
    expect(result.success).toBe(true);
  });
});

describe("Discount Schemas", () => {
  test("validates discount types", () => {
    expect(DiscountTypeSchema.safeParse("PERCENTAGE").success).toBe(true);
    expect(DiscountTypeSchema.safeParse("FREE_SHIPPING").success).toBe(true);
    expect(DiscountTypeSchema.safeParse("BOGOF").success).toBe(false);
  });

  test("validates discount", () => {
    const result = DiscountSchema.safeParse({
      id: "disc-123",
      code: "SAVE20",
      name: "20% Off Sale",
      description: "Summer sale discount",
      type: "PERCENTAGE",
      value: 20,
      scope: "ORDER",
      isActive: true,
      usageLimit: 1000,
      usageCount: 50,
      startsAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  test("validates apply discount request", () => {
    const result = ApplyDiscountRequestSchema.safeParse({
      sessionId: "session-123",
      code: "WELCOME10",
    });
    expect(result.success).toBe(true);
  });

  test("validates validate discount request", () => {
    const result = ValidateDiscountRequestSchema.safeParse({
      code: "SUMMER25",
      cartTotal: { amount: "100.00", currency: "USD" },
      productIds: ["prod-1", "prod-2"],
    });
    expect(result.success).toBe(true);
  });
});

describe("Identity Schemas", () => {
  test("validates OAuth2 token response", () => {
    const result = OAuth2TokenResponseSchema.safeParse({
      access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "refresh_token_here",
      scope: "openid profile email",
    });
    expect(result.success).toBe(true);
  });

  test("validates linked identity", () => {
    const result = LinkedIdentitySchema.safeParse({
      id: "identity-123",
      provider: "google",
      providerId: "12345678901234567890",
      email: "user@gmail.com",
      displayName: "John Doe",
      linkedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  test("validates identity link request", () => {
    const result = IdentityLinkRequestSchema.safeParse({
      provider: "google",
      redirectUri: "https://myapp.com/callback",
      scopes: ["openid", "email", "profile"],
    });
    expect(result.success).toBe(true);
  });

  test("validates authorization request with PKCE", () => {
    const result = AuthorizationRequestSchema.safeParse({
      response_type: "code",
      client_id: "client-123",
      redirect_uri: "https://myapp.com/oauth/callback",
      scope: "openid profile",
      state: "random-csrf-token",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });
    expect(result.success).toBe(true);
  });
});

describe("Webhook Schemas", () => {
  test("validates webhook event types", () => {
    expect(WebhookEventTypeSchema.safeParse("order.created").success).toBe(true);
    expect(WebhookEventTypeSchema.safeParse("shipment.delivered").success).toBe(true);
    expect(WebhookEventTypeSchema.safeParse("payment.captured").success).toBe(true);
    expect(WebhookEventTypeSchema.safeParse("invalid.event").success).toBe(false);
  });

  test("validates webhook endpoint", () => {
    const result = WebhookEndpointSchema.safeParse({
      id: "wh-123",
      url: "https://myapp.com/webhooks/ucp",
      events: ["order.created", "order.confirmed", "shipment.shipped"],
      secret: "whsec_supersecretkey",
      isActive: true,
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  test("rejects webhook endpoint with invalid events", () => {
    const result = WebhookEndpointSchema.safeParse({
      id: "wh-123",
      url: "https://myapp.com/webhooks",
      events: ["invalid.event"],
      secret: "secret",
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});
