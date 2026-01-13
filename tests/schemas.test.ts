import { describe, expect, test } from "bun:test";
import {
  MoneySchema,
  AddressSchema,
  CartSchema,
  CustomerSchema,
  CreateCheckoutRequestSchema,
  CheckoutSessionSchema,
  UCPDiscoveryResponseSchema,
} from "../src/sdk";

describe("UCP Schemas", () => {
  describe("MoneySchema", () => {
    test("validates correct money object", () => {
      const result = MoneySchema.safeParse({
        amount: "10.99",
        currency: "USD",
      });
      expect(result.success).toBe(true);
    });

    test("rejects invalid currency code", () => {
      const result = MoneySchema.safeParse({
        amount: "10.99",
        currency: "INVALID",
      });
      expect(result.success).toBe(false);
    });

    test("rejects missing amount", () => {
      const result = MoneySchema.safeParse({
        currency: "USD",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("AddressSchema", () => {
    test("validates complete address", () => {
      const result = AddressSchema.safeParse({
        line1: "123 Main St",
        line2: "Apt 4",
        city: "San Francisco",
        region: "CA",
        postalCode: "94102",
        country: "US",
      });
      expect(result.success).toBe(true);
    });

    test("validates address without optional fields", () => {
      const result = AddressSchema.safeParse({
        line1: "123 Main St",
        city: "San Francisco",
        postalCode: "94102",
        country: "US",
      });
      expect(result.success).toBe(true);
    });

    test("rejects invalid country code", () => {
      const result = AddressSchema.safeParse({
        line1: "123 Main St",
        city: "San Francisco",
        postalCode: "94102",
        country: "USA", // Should be 2 letters
      });
      expect(result.success).toBe(false);
    });
  });

  describe("CartSchema", () => {
    test("validates cart with items", () => {
      const result = CartSchema.safeParse({
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
      });
      expect(result.success).toBe(true);
    });

    test("validates cart with optional fields", () => {
      const result = CartSchema.safeParse({
        items: [
          {
            id: "item-1",
            productId: "prod-123",
            name: "Test Product",
            quantity: 1,
            unitPrice: { amount: "10.00", currency: "USD" },
            totalPrice: { amount: "10.00", currency: "USD" },
          },
        ],
        subtotal: { amount: "10.00", currency: "USD" },
        tax: { amount: "0.80", currency: "USD" },
        shipping: { amount: "5.00", currency: "USD" },
        discount: { amount: "2.00", currency: "USD" },
        total: { amount: "13.80", currency: "USD" },
      });
      expect(result.success).toBe(true);
    });

    test("rejects cart with invalid quantity", () => {
      const result = CartSchema.safeParse({
        items: [
          {
            id: "item-1",
            productId: "prod-123",
            name: "Test Product",
            quantity: -1, // Invalid
            unitPrice: { amount: "10.00", currency: "USD" },
            totalPrice: { amount: "10.00", currency: "USD" },
          },
        ],
        subtotal: { amount: "10.00", currency: "USD" },
        total: { amount: "10.00", currency: "USD" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("CustomerSchema", () => {
    test("validates customer with contact", () => {
      const result = CustomerSchema.safeParse({
        contact: {
          name: "John Doe",
          email: "john@example.com",
          phone: "+1234567890",
        },
      });
      expect(result.success).toBe(true);
    });

    test("validates customer with addresses", () => {
      const result = CustomerSchema.safeParse({
        id: "cust-123",
        contact: {
          name: "Jane Doe",
        },
        shippingAddress: {
          line1: "123 Ship St",
          city: "Ship City",
          postalCode: "11111",
          country: "US",
        },
        billingAddress: {
          line1: "456 Bill St",
          city: "Bill City",
          postalCode: "22222",
          country: "US",
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("CreateCheckoutRequestSchema", () => {
    test("validates minimal checkout request", () => {
      const result = CreateCheckoutRequestSchema.safeParse({
        merchantId: "merchant-123",
        cart: {
          items: [
            {
              id: "item-1",
              productId: "prod-1",
              name: "Product",
              quantity: 1,
              unitPrice: { amount: "10.00", currency: "USD" },
              totalPrice: { amount: "10.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "10.00", currency: "USD" },
          total: { amount: "10.00", currency: "USD" },
        },
      });
      expect(result.success).toBe(true);
    });

    test("validates full checkout request", () => {
      const result = CreateCheckoutRequestSchema.safeParse({
        merchantId: "merchant-123",
        cart: {
          items: [
            {
              id: "item-1",
              productId: "prod-1",
              name: "Product",
              quantity: 1,
              unitPrice: { amount: "10.00", currency: "USD" },
              totalPrice: { amount: "10.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "10.00", currency: "USD" },
          total: { amount: "10.00", currency: "USD" },
        },
        customer: {
          contact: {
            name: "Test Customer",
            email: "test@example.com",
          },
        },
        redirectUrls: {
          success: "https://example.com/success",
          cancel: "https://example.com/cancel",
        },
        metadata: {
          orderId: "order-123",
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("UCPDiscoveryResponseSchema", () => {
    test("validates discovery response", () => {
      const result = UCPDiscoveryResponseSchema.safeParse({
        version: "1.0.0",
        merchantId: "merchant-123",
        merchantName: "Test Store",
        services: [
          {
            name: "Shopping",
            capabilities: [
              {
                id: "dev.ucp.shopping.checkout",
                version: "1.0.0",
                extensions: ["discount", "fulfillment"],
              },
            ],
            bindings: [
              {
                type: "REST",
                endpoint: "https://example.com/ucp",
              },
            ],
          },
        ],
        paymentHandlers: [
          {
            id: "stripe",
            name: "Stripe",
            type: "STRIPE",
            supportedMethods: ["card"],
          },
        ],
        supportedCurrencies: ["USD", "EUR"],
        supportedCountries: ["US", "DE"],
      });
      expect(result.success).toBe(true);
    });
  });
});
