import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CheckoutSession, UCPDiscoveryResponse, Cart } from "../sdk";

export interface MCPServerConfig {
  merchantEndpoint: string;
}

// ============================================
// STATE MANAGEMENT
// ============================================

interface MCPServerState {
  currentSessionId: string | null;
  checkoutSessions: Map<string, CheckoutSession>;
  merchantCapabilities: UCPDiscoveryResponse | null;
  lastDiscoveryAt: number | null;
}

function createState(): MCPServerState {
  return {
    currentSessionId: null,
    checkoutSessions: new Map(),
    merchantCapabilities: null,
    lastDiscoveryAt: null,
  };
}

// Helper to create consistent tool responses
function toolResponse(data: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
    ...(isError && { isError: true }),
  };
}

// Helper for API calls
async function apiCall(
  endpoint: string,
  options?: RequestInit
): Promise<{ ok: boolean; data: unknown; status: number }> {
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "UCP-Agent": "mcp-ucp-server/1.0",
      ...options?.headers,
    },
  });
  const data = await response.json();
  return { ok: response.ok, data, status: response.status };
}

export function createUCPMCPServer(config: MCPServerConfig) {
  const server = new McpServer({
    name: "ucp-commerce",
    version: "1.0.0",
  });

  // Initialize state
  const state = createState();

  // Helper to update session state and notify
  function updateSessionState(session: CheckoutSession) {
    state.checkoutSessions.set(session.id, session);
    state.currentSessionId = session.id;
  }

  // ============================================
  // RESOURCES
  // ============================================

  // checkout://current - Current checkout session
  server.resource(
    "checkout://current",
    "Current checkout session state including cart, shipping, and payment status",
    async () => {
      if (!state.currentSessionId) {
        return {
          contents: [
            {
              uri: "checkout://current",
              mimeType: "application/json",
              text: JSON.stringify({ error: "No active checkout session" }),
            },
          ],
        };
      }

      // Fetch latest state from server
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/checkout/${state.currentSessionId}`
        );
        if (ok && data) {
          updateSessionState(data as CheckoutSession);
        }
        return {
          contents: [
            {
              uri: "checkout://current",
              mimeType: "application/json",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch {
        const cached = state.checkoutSessions.get(state.currentSessionId);
        return {
          contents: [
            {
              uri: "checkout://current",
              mimeType: "application/json",
              text: JSON.stringify(
                cached || { error: "Failed to fetch checkout session" },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );


  // merchant://capabilities - Cached discovery response
  server.resource(
    "merchant://capabilities",
    "Merchant UCP capabilities from /.well-known/ucp discovery",
    async () => {
      // Check if we need to refresh (cache for 5 minutes)
      const cacheMs = 5 * 60 * 1000;
      const needsRefresh =
        !state.merchantCapabilities ||
        !state.lastDiscoveryAt ||
        Date.now() - state.lastDiscoveryAt > cacheMs;

      if (needsRefresh) {
        try {
          const { ok, data } = await apiCall(
            `${config.merchantEndpoint}/.well-known/ucp`
          );
          if (ok && data) {
            state.merchantCapabilities = data as UCPDiscoveryResponse;
            state.lastDiscoveryAt = Date.now();
          }
        } catch {
          // Use cached if available
        }
      }

      return {
        contents: [
          {
            uri: "merchant://capabilities",
            mimeType: "application/json",
            text: JSON.stringify(
              state.merchantCapabilities || { error: "No capabilities discovered" },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // cart://items - Current cart contents
  server.resource(
    "cart://items",
    "Current cart items from active checkout session",
    async () => {
      if (!state.currentSessionId) {
        return {
          contents: [
            {
              uri: "cart://items",
              mimeType: "application/json",
              text: JSON.stringify({ items: [], total: { amount: "0", currency: "USD" } }),
            },
          ],
        };
      }

      const session = state.checkoutSessions.get(state.currentSessionId);
      const cart = session?.cart || { items: [], total: { amount: "0", currency: "USD" } };

      return {
        contents: [
          {
            uri: "cart://items",
            mimeType: "application/json",
            text: JSON.stringify(cart, null, 2),
          },
        ],
      };
    }
  );

  // cart://summary - Cart summary with totals
  server.resource(
    "cart://summary",
    "Cart summary with item count, subtotal, discounts, and total",
    async () => {
      if (!state.currentSessionId) {
        return {
          contents: [
            {
              uri: "cart://summary",
              mimeType: "application/json",
              text: JSON.stringify({
                itemCount: 0,
                subtotal: { amount: "0", currency: "USD" },
                discounts: [],
                shipping: null,
                total: { amount: "0", currency: "USD" },
              }),
            },
          ],
        };
      }

      const session = state.checkoutSessions.get(state.currentSessionId);
      const cart = session?.cart;

      const summary = {
        itemCount: cart?.items?.reduce((sum, item) => sum + item.quantity, 0) || 0,
        subtotal: cart?.subtotal || { amount: "0", currency: "USD" },
        discount: cart?.discount || null,
        shipping: cart?.shipping || null,
        tax: cart?.tax || null,
        total: cart?.total || { amount: "0", currency: "USD" },
      };

      return {
        contents: [
          {
            uri: "cart://summary",
            mimeType: "application/json",
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );

  // ============================================
  // DISCOVERY
  // ============================================

  server.tool(
    "discover_merchant",
    "Discover UCP capabilities of a merchant via /.well-known/ucp endpoint. Call this first to understand what the merchant supports.",
    {},
    async () => {
      try {
        const { ok, data } = await apiCall(`${config.merchantEndpoint}/.well-known/ucp`);
        if (ok && data) {
          state.merchantCapabilities = data as UCPDiscoveryResponse;
          state.lastDiscoveryAt = Date.now();
        }
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error discovering merchant: ${error}`, true);
      }
    }
  );

  // ============================================
  // CHECKOUT
  // ============================================

  server.tool(
    "create_checkout",
    "Create a new UCP checkout session with items in the cart. Returns a session ID for further operations.",
    {
      merchantId: z.string().describe("The merchant identifier"),
      items: z
        .array(
          z.object({
            productId: z.string(),
            name: z.string(),
            quantity: z.number(),
            unitPrice: z.object({
              amount: z.string(),
              currency: z.string(),
            }),
          })
        )
        .describe("Cart items to checkout"),
      customerEmail: z.string().email().optional().describe("Customer email"),
      customerName: z.string().optional().describe("Customer name"),
    },
    async ({ merchantId, items, customerEmail, customerName }) => {
      try {
        let subtotal = 0;
        const lineItems = items.map((item, index) => {
          const itemTotal = parseFloat(item.unitPrice.amount) * item.quantity;
          subtotal += itemTotal;
          return {
            id: `item-${index}`,
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: {
              amount: itemTotal.toFixed(2),
              currency: item.unitPrice.currency,
            },
          };
        });

        const currency = items[0]?.unitPrice.currency || "USD";
        const cart = {
          items: lineItems,
          subtotal: { amount: subtotal.toFixed(2), currency },
          total: { amount: subtotal.toFixed(2), currency },
        };

        const request = {
          merchantId,
          cart,
          customer:
            customerEmail || customerName
              ? {
                  contact: {
                    name: customerName || "Customer",
                    email: customerEmail,
                  },
                }
              : undefined,
        };

        const { ok, data } = await apiCall(`${config.merchantEndpoint}/ucp/checkout`, {
          method: "POST",
          body: JSON.stringify(request),
        });
        if (ok && data) {
          updateSessionState(data as CheckoutSession);
        }
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error creating checkout: ${error}`, true);
      }
    }
  );

  server.tool(
    "get_checkout",
    "Get the current status and details of a checkout session.",
    {
      sessionId: z.string().describe("The checkout session ID"),
    },
    async ({ sessionId }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}`
        );
        if (ok && data) {
          updateSessionState(data as CheckoutSession);
        }
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error getting checkout: ${error}`, true);
      }
    }
  );

  server.tool(
    "update_checkout",
    "Update a checkout session with shipping address, billing address, or other details.",
    {
      sessionId: z.string().describe("The checkout session ID"),
      shippingAddress: z
        .object({
          line1: z.string(),
          line2: z.string().optional(),
          city: z.string(),
          region: z.string().optional(),
          postalCode: z.string(),
          country: z.string().describe("2-letter country code"),
        })
        .optional()
        .describe("Shipping address"),
      billingAddress: z
        .object({
          line1: z.string(),
          line2: z.string().optional(),
          city: z.string(),
          region: z.string().optional(),
          postalCode: z.string(),
          country: z.string(),
        })
        .optional()
        .describe("Billing address (if different from shipping)"),
      customerEmail: z.string().email().optional(),
      customerName: z.string().optional(),
    },
    async ({ sessionId, shippingAddress, billingAddress, customerEmail, customerName }) => {
      try {
        const updates: Record<string, unknown> = {};
        if (shippingAddress) updates.shippingAddress = shippingAddress;
        if (billingAddress) updates.billingAddress = billingAddress;
        if (customerEmail || customerName) {
          updates.customer = {
            contact: {
              ...(customerName && { name: customerName }),
              ...(customerEmail && { email: customerEmail }),
            },
          };
        }

        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}`,
          {
            method: "PATCH",
            body: JSON.stringify(updates),
          }
        );
        if (ok && data) {
          updateSessionState(data as CheckoutSession);
        }
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error updating checkout: ${error}`, true);
      }
    }
  );

  server.tool(
    "cancel_checkout",
    "Cancel/abandon a checkout session. Use when the user wants to stop the checkout process.",
    {
      sessionId: z.string().describe("The checkout session ID to cancel"),
      reason: z.string().optional().describe("Reason for cancellation"),
    },
    async ({ sessionId, reason }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ status: "CANCELLED", cancelReason: reason }),
          }
        );
        if (ok && data) {
          updateSessionState(data as CheckoutSession);
          // Clear current session if cancelled
          if (state.currentSessionId === sessionId) {
            state.currentSessionId = null;
          }
        }
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error cancelling checkout: ${error}`, true);
      }
    }
  );

  // ============================================
  // DISCOUNTS
  // ============================================

  server.tool(
    "apply_discount",
    "Apply a promotional discount code to a checkout session.",
    {
      sessionId: z.string().describe("The checkout session ID"),
      code: z.string().describe("The promotional/discount code to apply"),
    },
    async ({ sessionId, code }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}/discount`,
          {
            method: "POST",
            body: JSON.stringify({ code }),
          }
        );
        if (ok && data) {
          updateSessionState(data as CheckoutSession);
        }
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error applying discount: ${error}`, true);
      }
    }
  );

  server.tool(
    "remove_discount",
    "Remove a previously applied discount from a checkout session.",
    {
      sessionId: z.string().describe("The checkout session ID"),
      discountId: z.string().describe("The discount ID to remove"),
    },
    async ({ sessionId, discountId }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}/discount/${discountId}`,
          {
            method: "DELETE",
          }
        );
        if (ok && data) {
          updateSessionState(data as CheckoutSession);
        }
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error removing discount: ${error}`, true);
      }
    }
  );

  // ============================================
  // SHIPPING
  // ============================================

  server.tool(
    "get_shipping_options",
    "Get available shipping options for a checkout session. Requires shipping address to be set first.",
    {
      sessionId: z.string().describe("The checkout session ID"),
    },
    async ({ sessionId }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}/shipping-options`
        );
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error getting shipping options: ${error}`, true);
      }
    }
  );

  server.tool(
    "select_shipping",
    "Select a shipping option for the checkout session.",
    {
      sessionId: z.string().describe("The checkout session ID"),
      shippingOptionId: z.string().describe("The ID of the shipping option to select"),
    },
    async ({ sessionId, shippingOptionId }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ selectedShippingOptionId: shippingOptionId }),
          }
        );
        if (ok && data) {
          updateSessionState(data as CheckoutSession);
        }
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error selecting shipping: ${error}`, true);
      }
    }
  );

  // ============================================
  // PAYMENT
  // ============================================

  server.tool(
    "get_payment_methods",
    "Get available payment methods for a checkout session.",
    {
      sessionId: z.string().describe("The checkout session ID"),
    },
    async ({ sessionId }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}/payment-methods`
        );
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error getting payment methods: ${error}`, true);
      }
    }
  );

  server.tool(
    "complete_payment",
    "Complete the checkout by processing payment. This finalizes the order.",
    {
      sessionId: z.string().describe("The checkout session ID"),
      paymentMethodType: z
        .string()
        .describe("Payment method type (e.g., 'card', 'google_pay', 'apple_pay')"),
      paymentToken: z
        .string()
        .optional()
        .describe("Payment token from payment provider (if required)"),
      savePaymentMethod: z
        .boolean()
        .optional()
        .describe("Whether to save payment method for future use"),
    },
    async ({ sessionId, paymentMethodType, paymentToken, savePaymentMethod }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}/complete`,
          {
            method: "POST",
            body: JSON.stringify({
              paymentMethod: {
                type: paymentMethodType,
                token: paymentToken,
              },
              savePaymentMethod,
            }),
          }
        );
        if (ok && data) {
          updateSessionState(data as CheckoutSession);
        }
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error completing payment: ${error}`, true);
      }
    }
  );

  // ============================================
  // ORDERS
  // ============================================

  server.tool(
    "get_order",
    "Get details of an order by order ID.",
    {
      orderId: z.string().describe("The order ID"),
    },
    async ({ orderId }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/orders/${orderId}`
        );
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error getting order: ${error}`, true);
      }
    }
  );

  server.tool(
    "get_order_status",
    "Get the current status of an order including fulfillment and shipping info.",
    {
      orderId: z.string().describe("The order ID"),
    },
    async ({ orderId }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/orders/${orderId}/status`
        );
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error getting order status: ${error}`, true);
      }
    }
  );

  server.tool(
    "list_orders",
    "List orders for a customer.",
    {
      customerId: z.string().optional().describe("Filter by customer ID"),
      status: z
        .enum(["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"])
        .optional()
        .describe("Filter by order status"),
      limit: z.number().optional().describe("Maximum number of orders to return (default 20)"),
    },
    async ({ customerId, status, limit }) => {
      try {
        const params = new URLSearchParams();
        if (customerId) params.set("customerId", customerId);
        if (status) params.set("status", status);
        if (limit) params.set("limit", String(limit));

        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/orders?${params.toString()}`
        );
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error listing orders: ${error}`, true);
      }
    }
  );

  // ============================================
  // RETURNS
  // ============================================

  server.tool(
    "request_return",
    "Request a return for items in an order.",
    {
      orderId: z.string().describe("The order ID"),
      items: z
        .array(
          z.object({
            lineItemId: z.string(),
            quantity: z.number(),
          })
        )
        .describe("Items to return"),
      reason: z
        .enum([
          "DEFECTIVE",
          "WRONG_ITEM",
          "NOT_AS_DESCRIBED",
          "CHANGED_MIND",
          "BETTER_PRICE_FOUND",
          "ARRIVED_LATE",
          "OTHER",
        ])
        .describe("Reason for return"),
      reasonDetails: z.string().optional().describe("Additional details about the return reason"),
    },
    async ({ orderId, items, reason, reasonDetails }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/orders/${orderId}/returns`,
          {
            method: "POST",
            body: JSON.stringify({ items, reason, reasonDetails }),
          }
        );
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error requesting return: ${error}`, true);
      }
    }
  );

  // Expose state for testing
  return Object.assign(server, {
    getState: () => state,
    clearState: () => {
      state.currentSessionId = null;
      state.checkoutSessions.clear();
      state.merchantCapabilities = null;
      state.lastDiscoveryAt = null;
    },
  });
}

export type UCPMCPServer = ReturnType<typeof createUCPMCPServer>;

// Run as standalone MCP server
export async function runMCPServer(config: MCPServerConfig) {
  const server = createUCPMCPServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
