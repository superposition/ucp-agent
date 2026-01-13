import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CartSchema,
  CustomerSchema,
  MoneySchema,
} from "../sdk";

export interface MCPServerConfig {
  merchantEndpoint: string;
}

export function createUCPMCPServer(config: MCPServerConfig) {
  const server = new McpServer({
    name: "ucp-commerce",
    version: "1.0.0",
  });

  // Tool: Discover merchant capabilities
  server.tool(
    "discover_merchant",
    "Discover UCP capabilities of a merchant via /.well-known/ucp endpoint",
    {},
    async () => {
      try {
        const response = await fetch(`${config.merchantEndpoint}/.well-known/ucp`);
        const discovery = await response.json();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(discovery, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error discovering merchant: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Create checkout session
  server.tool(
    "create_checkout",
    "Create a new UCP checkout session",
    {
      merchantId: z.string().describe("The merchant identifier"),
      items: z.array(
        z.object({
          productId: z.string(),
          name: z.string(),
          quantity: z.number(),
          unitPrice: z.object({
            amount: z.string(),
            currency: z.string(),
          }),
        })
      ).describe("Cart items to checkout"),
      customerEmail: z.string().email().optional().describe("Customer email"),
      customerName: z.string().optional().describe("Customer name"),
    },
    async ({ merchantId, items, customerEmail, customerName }) => {
      try {
        // Build cart from items
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
          customer: customerEmail || customerName ? {
            contact: {
              name: customerName || "Customer",
              email: customerEmail,
            },
          } : undefined,
        };

        const response = await fetch(`${config.merchantEndpoint}/ucp/checkout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "UCP-Agent": "mcp-ucp-server/1.0",
          },
          body: JSON.stringify(request),
        });

        const session = await response.json();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(session, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating checkout: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Get checkout session
  server.tool(
    "get_checkout",
    "Get the current status of a checkout session",
    {
      sessionId: z.string().describe("The checkout session ID"),
    },
    async ({ sessionId }) => {
      try {
        const response = await fetch(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}`
        );
        const session = await response.json();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(session, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting checkout: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: Update checkout with shipping/billing
  server.tool(
    "update_checkout",
    "Update a checkout session with shipping or billing information",
    {
      sessionId: z.string().describe("The checkout session ID"),
      shippingAddress: z.object({
        line1: z.string(),
        city: z.string(),
        postalCode: z.string(),
        country: z.string(),
      }).optional(),
      discountCode: z.string().optional(),
    },
    async ({ sessionId, shippingAddress, discountCode }) => {
      try {
        const response = await fetch(
          `${config.merchantEndpoint}/ucp/checkout/${sessionId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shippingAddress, discountCode }),
          }
        );
        const session = await response.json();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(session, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating checkout: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

// Run as standalone MCP server
export async function runMCPServer(config: MCPServerConfig) {
  const server = createUCPMCPServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
