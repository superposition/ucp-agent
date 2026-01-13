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

  // catalog://products - Product catalog
  server.resource(
    "catalog://products",
    "Available products from the merchant catalog",
    async () => {
      try {
        const { ok, data } = await apiCall(`${config.merchantEndpoint}/ucp/products`);
        return {
          contents: [
            {
              uri: "catalog://products",
              mimeType: "application/json",
              text: JSON.stringify(ok ? data : { error: "Failed to fetch products" }, null, 2),
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: "catalog://products",
              mimeType: "application/json",
              text: JSON.stringify({ error: "Failed to fetch products" }),
            },
          ],
        };
      }
    }
  );

  // catalog://categories - Product categories
  server.resource(
    "catalog://categories",
    "Available product categories from the merchant",
    async () => {
      try {
        const { ok, data } = await apiCall(`${config.merchantEndpoint}/ucp/categories`);
        return {
          contents: [
            {
              uri: "catalog://categories",
              mimeType: "application/json",
              text: JSON.stringify(ok ? data : { error: "Failed to fetch categories" }, null, 2),
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: "catalog://categories",
              mimeType: "application/json",
              text: JSON.stringify({ error: "Failed to fetch categories" }),
            },
          ],
        };
      }
    }
  );

  // ============================================
  // PROMPTS
  // ============================================

  // Start shopping - Initialize shopping flow
  server.prompt(
    "start_shopping",
    "Initialize a shopping session with the merchant. Use this to begin a new purchase flow.",
    {
      customerName: z.string().optional().describe("Customer's name for personalization"),
      customerEmail: z.string().email().optional().describe("Customer's email for order updates"),
    },
    async ({ customerName, customerEmail }) => {
      let context = `You are helping a customer shop at ${config.merchantEndpoint}.`;

      if (customerName) {
        context += ` The customer's name is ${customerName}.`;
      }
      if (customerEmail) {
        context += ` Their email is ${customerEmail}.`;
      }

      // Include current merchant capabilities if available
      let capabilitiesInfo = "";
      if (state.merchantCapabilities) {
        capabilitiesInfo = `\n\nMerchant: ${state.merchantCapabilities.merchantName} (ID: ${state.merchantCapabilities.merchantId})`;
      }

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `${context}${capabilitiesInfo}

To start shopping:
1. First use the discover_merchant tool to understand what the merchant offers
2. Help the customer browse and select products
3. Use create_checkout to start a checkout when they're ready
4. Guide them through providing shipping and payment information

Please begin by discovering what this merchant offers.`,
            },
          },
        ],
      };
    }
  );

  // Complete checkout - Guide through payment
  server.prompt(
    "complete_checkout",
    "Guide the customer through completing their checkout with shipping and payment.",
    {
      sessionId: z.string().optional().describe("Checkout session ID (uses current session if not provided)"),
    },
    async ({ sessionId }) => {
      const targetSessionId = sessionId || state.currentSessionId;

      if (!targetSessionId) {
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "There is no active checkout session. Please help the customer add items to their cart first using create_checkout.",
              },
            },
          ],
        };
      }

      // Get current session state
      const session = state.checkoutSessions.get(targetSessionId);
      let sessionInfo = "";
      if (session) {
        sessionInfo = `\n\nCurrent checkout:
- Session ID: ${session.id}
- Status: ${session.status}
- Items: ${session.cart.items.length}
- Total: ${session.cart.total.amount} ${session.cart.total.currency}`;
      }

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Help the customer complete their checkout (Session: ${targetSessionId}).${sessionInfo}

Steps to complete checkout:
1. Use get_checkout to see current session status
2. Use update_checkout to add shipping address if needed
3. Use get_shipping_options to show available shipping methods
4. Use select_shipping to choose a shipping option
5. Use get_payment_methods to show payment options
6. Use complete_payment to finalize the order

Please check the current checkout status and guide the customer through the remaining steps.`,
            },
          },
        ],
      };
    }
  );

  // Track order - Post-purchase queries
  server.prompt(
    "track_order",
    "Help the customer track their order status and shipment.",
    {
      orderId: z.string().describe("The order ID to track"),
    },
    async ({ orderId }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `The customer wants to track order ${orderId}.

Use these tools to help:
1. Use get_order to get full order details
2. Use get_order_status to see current fulfillment status

Please fetch the order information and provide the customer with:
- Current order status
- Shipping/tracking information if available
- Expected delivery date if known
- Any actions they can take (like requesting a return)`,
            },
          },
        ],
      };
    }
  );

  // Apply discount - Coupon/promo workflow
  server.prompt(
    "apply_discount",
    "Help the customer apply a discount or promotional code to their checkout.",
    {
      code: z.string().describe("The discount/promo code to apply"),
      sessionId: z.string().optional().describe("Checkout session ID (uses current session if not provided)"),
    },
    async ({ code, sessionId }) => {
      const targetSessionId = sessionId || state.currentSessionId;

      if (!targetSessionId) {
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `The customer wants to use discount code "${code}" but there is no active checkout session. Please help them add items to their cart first using create_checkout.`,
              },
            },
          ],
        };
      }

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `The customer wants to apply discount code "${code}" to their checkout (Session: ${targetSessionId}).

Steps:
1. Use apply_discount with the code and session ID
2. If successful, show the customer the updated cart total with the discount applied
3. If the code is invalid or expired, explain the issue and ask if they have another code

Please try applying the discount code now.`,
            },
          },
        ],
      };
    }
  );

  // Browse products - Product discovery
  server.prompt(
    "browse_products",
    "Help the customer browse and find products from the merchant.",
    {
      category: z.string().optional().describe("Product category to browse"),
      searchQuery: z.string().optional().describe("Search term for products"),
    },
    async ({ category, searchQuery }) => {
      let browseContext = "The customer wants to browse products.";
      if (category) {
        browseContext = `The customer wants to browse products in the "${category}" category.`;
      }
      if (searchQuery) {
        browseContext = `The customer is searching for: "${searchQuery}"`;
      }

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `${browseContext}

First, use discover_merchant to understand what products and categories are available.
Then help the customer find what they're looking for.

When they find products they want:
1. Show clear pricing information
2. Confirm quantities
3. Offer to add items to checkout using create_checkout`,
            },
          },
        ],
      };
    }
  );

  // Request return - Return workflow
  server.prompt(
    "request_return",
    "Help the customer initiate a return for items from their order.",
    {
      orderId: z.string().describe("The order ID containing items to return"),
    },
    async ({ orderId }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `The customer wants to return items from order ${orderId}.

Steps:
1. Use get_order to see the order details and items
2. Ask which items they want to return and the quantities
3. Ask for the return reason (defective, wrong item, changed mind, etc.)
4. Use request_return to submit the return request
5. Provide the customer with any return instructions or next steps

Please fetch the order details first.`,
            },
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
  // PRODUCT CATALOG
  // ============================================

  server.tool(
    "list_products",
    "List available products from the merchant catalog. Can filter by category, search term, or stock status.",
    {
      category: z.string().optional().describe("Filter by category ID"),
      search: z.string().optional().describe("Search term to filter products by name or description"),
      inStock: z.boolean().optional().describe("Filter by stock availability (true = in stock only)"),
    },
    async ({ category, search, inStock }) => {
      try {
        const params = new URLSearchParams();
        if (category) params.set("category", category);
        if (search) params.set("search", search);
        if (inStock !== undefined) params.set("inStock", String(inStock));

        const queryString = params.toString();
        const url = `${config.merchantEndpoint}/ucp/products${queryString ? `?${queryString}` : ""}`;
        const { ok, data } = await apiCall(url);
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error listing products: ${error}`, true);
      }
    }
  );

  server.tool(
    "get_product",
    "Get detailed information about a specific product by its ID.",
    {
      productId: z.string().describe("The product ID to look up"),
    },
    async ({ productId }) => {
      try {
        const { ok, data } = await apiCall(
          `${config.merchantEndpoint}/ucp/products/${productId}`
        );
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error getting product: ${error}`, true);
      }
    }
  );

  server.tool(
    "list_categories",
    "List available product categories from the merchant catalog.",
    {},
    async () => {
      try {
        const { ok, data } = await apiCall(`${config.merchantEndpoint}/ucp/categories`);
        return toolResponse(data, !ok);
      } catch (error) {
        return toolResponse(`Error listing categories: ${error}`, true);
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
