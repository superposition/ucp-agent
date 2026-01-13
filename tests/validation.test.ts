import { describe, expect, test } from "bun:test";
import {
  validate,
  validateCheckoutRequest,
  validateCheckoutSession,
  validateDiscoveryResponse,
  validateMoney,
  validateAddress,
  validateCart,
  validateCustomer,
  validateOrder,
  validateCartTotals,
  isValidMoney,
  isValidCurrency,
  isKnownCurrency,
  isValidMoneyAmount,
  parseMoneyAmount,
  formatMoneyAmount,
  addMoney,
  subtractMoney,
  compareMoney,
  isValidAddress,
  isValidCountryCode,
  isValidCart,
  isValidCustomer,
  hasCapability,
  getBinding,
  formatZodErrors,
  formatErrorsAsString,
  type FormattedError,
} from "../src/sdk/validation";
import { MoneySchema } from "../src/sdk/schemas/common";

describe("Validation Utilities", () => {
  describe("formatZodErrors", () => {
    test("formats missing required field", () => {
      const result = MoneySchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = formatZodErrors(result.error);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some((e) => e.path === "amount")).toBe(true);
      }
    });

    test("formats type mismatch", () => {
      const result = MoneySchema.safeParse({ amount: 123, currency: "USD" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = formatZodErrors(result.error);
        expect(errors[0].message).toContain("Expected");
      }
    });
  });

  describe("formatErrorsAsString", () => {
    test("formats single error", () => {
      const errors: FormattedError[] = [
        { path: "amount", message: "Required", code: "invalid_type" },
      ];
      const str = formatErrorsAsString(errors);
      expect(str).toBe("amount: Required");
    });

    test("formats multiple errors", () => {
      const errors: FormattedError[] = [
        { path: "amount", message: "Required", code: "invalid_type" },
        { path: "currency", message: "Required", code: "invalid_type" },
      ];
      const str = formatErrorsAsString(errors);
      expect(str).toContain("• amount: Required");
      expect(str).toContain("• currency: Required");
    });

    test("formats root error without path prefix", () => {
      const errors: FormattedError[] = [
        { path: "(root)", message: "Invalid object", code: "invalid_type" },
      ];
      const str = formatErrorsAsString(errors);
      expect(str).toBe("Invalid object");
    });

    test("returns 'No errors' for empty array", () => {
      expect(formatErrorsAsString([])).toBe("No errors");
    });
  });

  describe("validate (generic)", () => {
    test("returns success for valid data", () => {
      const result = validate(MoneySchema, { amount: "10.00", currency: "USD" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.amount).toBe("10.00");
        expect(result.data.currency).toBe("USD");
      }
    });

    test("returns errors for invalid data", () => {
      const result = validate(MoneySchema, { amount: 123 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.rawErrors).toBeDefined();
      }
    });
  });

  describe("validateCheckoutRequest", () => {
    test("validates complete checkout request", () => {
      const result = validateCheckoutRequest({
        merchantId: "merch-1",
        cart: {
          items: [
            {
              id: "item-1",
              productId: "prod-1",
              name: "Test Item",
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

    test("rejects missing merchantId", () => {
      const result = validateCheckoutRequest({
        cart: {
          items: [],
          subtotal: { amount: "0", currency: "USD" },
          total: { amount: "0", currency: "USD" },
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path === "merchantId")).toBe(true);
      }
    });

    test("rejects missing cart", () => {
      const result = validateCheckoutRequest({
        merchantId: "merch-1",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("validateDiscoveryResponse", () => {
    test("validates complete discovery response", () => {
      const result = validateDiscoveryResponse({
        version: "1.0.0",
        merchantId: "test-merchant",
        merchantName: "Test Store",
        services: [
          {
            name: "Shopping",
            capabilities: [
              { id: "dev.ucp.shopping.checkout", version: "1.0.0" },
            ],
            bindings: [
              { type: "REST", endpoint: "https://example.com/ucp" },
            ],
          },
        ],
      });

      expect(result.success).toBe(true);
    });

    test("rejects invalid binding type", () => {
      const result = validateDiscoveryResponse({
        version: "1.0.0",
        merchantId: "test-merchant",
        merchantName: "Test Store",
        services: [
          {
            name: "Shopping",
            capabilities: [],
            bindings: [
              { type: "INVALID", endpoint: "https://example.com" },
            ],
          },
        ],
      });

      expect(result.success).toBe(false);
    });
  });

  describe("hasCapability", () => {
    const discovery = {
      version: "1.0.0",
      merchantId: "test",
      merchantName: "Test",
      services: [
        {
          name: "Shopping",
          capabilities: [
            { id: "dev.ucp.shopping.checkout", version: "1.0.0" },
            { id: "dev.ucp.shopping.orders", version: "1.0.0" },
          ],
          bindings: [{ type: "REST" as const, endpoint: "https://example.com" }],
        },
      ],
    };

    test("returns true for existing capability", () => {
      expect(hasCapability(discovery, "dev.ucp.shopping.checkout")).toBe(true);
    });

    test("returns false for missing capability", () => {
      expect(hasCapability(discovery, "dev.ucp.shopping.inventory")).toBe(false);
    });
  });

  describe("getBinding", () => {
    const discovery = {
      version: "1.0.0",
      merchantId: "test",
      merchantName: "Test",
      services: [
        {
          name: "Shopping",
          capabilities: [],
          bindings: [
            { type: "REST" as const, endpoint: "https://api.example.com/ucp" },
            { type: "MCP" as const, endpoint: "https://mcp.example.com" },
          ],
        },
      ],
    };

    test("returns REST endpoint", () => {
      expect(getBinding(discovery, "REST")).toBe("https://api.example.com/ucp");
    });

    test("returns MCP endpoint", () => {
      expect(getBinding(discovery, "MCP")).toBe("https://mcp.example.com");
    });

    test("returns undefined for missing binding", () => {
      expect(getBinding(discovery, "A2A")).toBeUndefined();
    });
  });

  describe("Money Validation", () => {
    describe("validateMoney", () => {
      test("validates correct money object", () => {
        const result = validateMoney({ amount: "99.99", currency: "USD" });
        expect(result.success).toBe(true);
      });

      test("rejects invalid currency length", () => {
        const result = validateMoney({ amount: "10.00", currency: "US" });
        expect(result.success).toBe(false);
      });
    });

    describe("isValidMoney", () => {
      test("returns true for valid money", () => {
        expect(isValidMoney({ amount: "50.00", currency: "EUR" })).toBe(true);
      });

      test("returns false for invalid money", () => {
        expect(isValidMoney({ amount: 50, currency: "EUR" })).toBe(false);
        expect(isValidMoney(null)).toBe(false);
        expect(isValidMoney("10.00")).toBe(false);
      });
    });

    describe("isValidCurrency", () => {
      test("returns true for valid currency codes", () => {
        expect(isValidCurrency("USD")).toBe(true);
        expect(isValidCurrency("EUR")).toBe(true);
        expect(isValidCurrency("JPY")).toBe(true);
      });

      test("returns false for invalid currency codes", () => {
        expect(isValidCurrency("US")).toBe(false);
        expect(isValidCurrency("USDD")).toBe(false);
        expect(isValidCurrency("usd")).toBe(false);
        expect(isValidCurrency("123")).toBe(false);
      });
    });

    describe("isKnownCurrency", () => {
      test("returns true for known currencies", () => {
        expect(isKnownCurrency("USD")).toBe(true);
        expect(isKnownCurrency("EUR")).toBe(true);
        expect(isKnownCurrency("GBP")).toBe(true);
        expect(isKnownCurrency("JPY")).toBe(true);
      });

      test("returns false for unknown currencies", () => {
        expect(isKnownCurrency("XYZ")).toBe(false);
        expect(isKnownCurrency("ABC")).toBe(false);
      });
    });

    describe("isValidMoneyAmount", () => {
      test("returns true for valid amounts", () => {
        expect(isValidMoneyAmount("0")).toBe(true);
        expect(isValidMoneyAmount("10")).toBe(true);
        expect(isValidMoneyAmount("10.00")).toBe(true);
        expect(isValidMoneyAmount("99.99")).toBe(true);
        expect(isValidMoneyAmount("1000000.50")).toBe(true);
      });

      test("returns false for invalid amounts", () => {
        expect(isValidMoneyAmount("")).toBe(false);
        expect(isValidMoneyAmount("abc")).toBe(false);
        expect(isValidMoneyAmount("$10.00")).toBe(false);
        expect(isValidMoneyAmount("10.00.00")).toBe(false);
        expect(isValidMoneyAmount("-5.00")).toBe(false); // Negative not allowed
      });
    });

    describe("parseMoneyAmount", () => {
      test("parses valid amounts", () => {
        expect(parseMoneyAmount("10.50")).toBe(10.5);
        expect(parseMoneyAmount("100")).toBe(100);
        expect(parseMoneyAmount("0")).toBe(0);
      });

      test("returns null for invalid amounts", () => {
        expect(parseMoneyAmount("abc")).toBeNull();
        expect(parseMoneyAmount("-10")).toBeNull();
      });
    });

    describe("formatMoneyAmount", () => {
      test("formats to 2 decimal places", () => {
        expect(formatMoneyAmount(10)).toBe("10.00");
        expect(formatMoneyAmount(10.5)).toBe("10.50");
        expect(formatMoneyAmount(10.999)).toBe("11.00");
      });
    });

    describe("addMoney", () => {
      test("adds money with same currency", () => {
        const result = addMoney(
          { amount: "10.00", currency: "USD" },
          { amount: "5.50", currency: "USD" }
        );
        expect(result).toEqual({ amount: "15.50", currency: "USD" });
      });

      test("returns null for different currencies", () => {
        const result = addMoney(
          { amount: "10.00", currency: "USD" },
          { amount: "5.00", currency: "EUR" }
        );
        expect(result).toBeNull();
      });
    });

    describe("subtractMoney", () => {
      test("subtracts money with same currency", () => {
        const result = subtractMoney(
          { amount: "10.00", currency: "USD" },
          { amount: "3.50", currency: "USD" }
        );
        expect(result).toEqual({ amount: "6.50", currency: "USD" });
      });

      test("allows negative result", () => {
        const result = subtractMoney(
          { amount: "5.00", currency: "USD" },
          { amount: "10.00", currency: "USD" }
        );
        expect(result).toEqual({ amount: "-5.00", currency: "USD" });
      });

      test("returns null for different currencies", () => {
        const result = subtractMoney(
          { amount: "10.00", currency: "USD" },
          { amount: "5.00", currency: "EUR" }
        );
        expect(result).toBeNull();
      });
    });

    describe("compareMoney", () => {
      test("compares equal amounts", () => {
        expect(
          compareMoney(
            { amount: "10.00", currency: "USD" },
            { amount: "10.00", currency: "USD" }
          )
        ).toBe(0);
      });

      test("compares less than", () => {
        expect(
          compareMoney(
            { amount: "5.00", currency: "USD" },
            { amount: "10.00", currency: "USD" }
          )
        ).toBe(-1);
      });

      test("compares greater than", () => {
        expect(
          compareMoney(
            { amount: "15.00", currency: "USD" },
            { amount: "10.00", currency: "USD" }
          )
        ).toBe(1);
      });

      test("returns null for different currencies", () => {
        expect(
          compareMoney(
            { amount: "10.00", currency: "USD" },
            { amount: "10.00", currency: "EUR" }
          )
        ).toBeNull();
      });
    });
  });

  describe("Address Validation", () => {
    describe("validateAddress", () => {
      test("validates complete address", () => {
        const result = validateAddress({
          line1: "123 Main St",
          city: "Portland",
          postalCode: "97201",
          country: "US",
        });
        expect(result.success).toBe(true);
      });

      test("rejects missing required fields", () => {
        const result = validateAddress({
          line1: "123 Main St",
          city: "Portland",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("isValidAddress", () => {
      test("returns true for valid address", () => {
        expect(
          isValidAddress({
            line1: "456 Oak Ave",
            city: "Seattle",
            postalCode: "98101",
            country: "US",
          })
        ).toBe(true);
      });

      test("returns false for invalid address", () => {
        expect(isValidAddress({ line1: "test" })).toBe(false);
      });
    });

    describe("isValidCountryCode", () => {
      test("returns true for valid codes", () => {
        expect(isValidCountryCode("US")).toBe(true);
        expect(isValidCountryCode("GB")).toBe(true);
        expect(isValidCountryCode("DE")).toBe(true);
      });

      test("returns false for invalid codes", () => {
        expect(isValidCountryCode("USA")).toBe(false);
        expect(isValidCountryCode("U")).toBe(false);
        expect(isValidCountryCode("us")).toBe(false);
      });
    });
  });

  describe("Cart Validation", () => {
    describe("validateCart", () => {
      test("validates complete cart", () => {
        const result = validateCart({
          items: [
            {
              id: "1",
              productId: "prod-1",
              name: "Test",
              quantity: 1,
              unitPrice: { amount: "10.00", currency: "USD" },
              totalPrice: { amount: "10.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "10.00", currency: "USD" },
          total: { amount: "10.00", currency: "USD" },
        });
        expect(result.success).toBe(true);
      });

      test("validates empty cart", () => {
        const result = validateCart({
          items: [],
          subtotal: { amount: "0.00", currency: "USD" },
          total: { amount: "0.00", currency: "USD" },
        });
        expect(result.success).toBe(true);
      });
    });

    describe("isValidCart", () => {
      test("returns true for valid cart", () => {
        expect(
          isValidCart({
            items: [],
            subtotal: { amount: "0", currency: "USD" },
            total: { amount: "0", currency: "USD" },
          })
        ).toBe(true);
      });
    });

    describe("validateCartTotals", () => {
      test("returns empty array for consistent totals", () => {
        const cart = {
          items: [
            {
              id: "1",
              productId: "prod-1",
              name: "Item 1",
              quantity: 2,
              unitPrice: { amount: "10.00", currency: "USD" },
              totalPrice: { amount: "20.00", currency: "USD" },
            },
            {
              id: "2",
              productId: "prod-2",
              name: "Item 2",
              quantity: 1,
              unitPrice: { amount: "15.00", currency: "USD" },
              totalPrice: { amount: "15.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "35.00", currency: "USD" },
          tax: { amount: "3.50", currency: "USD" },
          shipping: { amount: "5.00", currency: "USD" },
          total: { amount: "43.50", currency: "USD" },
        };

        const errors = validateCartTotals(cart);
        expect(errors).toEqual([]);
      });

      test("detects subtotal mismatch", () => {
        const cart = {
          items: [
            {
              id: "1",
              productId: "prod-1",
              name: "Item",
              quantity: 1,
              unitPrice: { amount: "10.00", currency: "USD" },
              totalPrice: { amount: "10.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "20.00", currency: "USD" }, // Wrong!
          total: { amount: "20.00", currency: "USD" },
        };

        const errors = validateCartTotals(cart);
        expect(errors.some((e) => e.code === "subtotal_mismatch")).toBe(true);
      });

      test("detects total mismatch with discount", () => {
        const cart = {
          items: [
            {
              id: "1",
              productId: "prod-1",
              name: "Item",
              quantity: 1,
              unitPrice: { amount: "100.00", currency: "USD" },
              totalPrice: { amount: "100.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "100.00", currency: "USD" },
          discount: { amount: "10.00", currency: "USD" },
          total: { amount: "100.00", currency: "USD" }, // Should be 90!
        };

        const errors = validateCartTotals(cart);
        expect(errors.some((e) => e.code === "total_mismatch")).toBe(true);
      });
    });
  });

  describe("Customer Validation", () => {
    describe("validateCustomer", () => {
      test("validates complete customer", () => {
        const result = validateCustomer({
          id: "cust-1",
          contact: {
            name: "John Doe",
            email: "john@example.com",
            phone: "+1234567890",
          },
        });
        expect(result.success).toBe(true);
      });

      test("validates customer without optional fields", () => {
        const result = validateCustomer({
          contact: { name: "Jane Doe" },
        });
        expect(result.success).toBe(true);
      });
    });

    describe("isValidCustomer", () => {
      test("returns true for valid customer", () => {
        expect(isValidCustomer({ contact: { name: "Test User" } })).toBe(true);
      });

      test("returns false for missing contact", () => {
        expect(isValidCustomer({})).toBe(false);
      });
    });
  });

  describe("Order Validation", () => {
    test("validateOrder validates complete order", () => {
      const result = validateOrder({
        id: "order-1",
        merchantId: "merch-1",
        checkoutSessionId: "session-1",
        orderNumber: "ORD-001",
        status: "CONFIRMED",
        customer: {
          contact: { name: "Test User" },
        },
        lineItems: [
          {
            id: "item-1",
            productId: "prod-1",
            name: "Test Product",
            quantity: 1,
            quantityFulfilled: 0,
            quantityCancelled: 0,
            unitPrice: { amount: "10.00", currency: "USD" },
            totalPrice: { amount: "10.00", currency: "USD" },
          },
        ],
        totals: {
          subtotal: { amount: "10.00", currency: "USD" },
          total: { amount: "10.00", currency: "USD" },
        },
        payments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      expect(result.success).toBe(true);
    });
  });
});
