import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  type UCPDiscoveryResponse,
  type CheckoutSession,
  type CreateCheckoutRequest,
  CreateCheckoutRequestSchema,
} from "../sdk";

export interface UCPServerConfig {
  merchantId: string;
  merchantName: string;
  port?: number;
}

export function createUCPServer(config: UCPServerConfig) {
  const app = new Hono();

  // In-memory session store (replace with DB in production)
  const sessions = new Map<string, CheckoutSession>();

  app.use("*", cors());

  // UCP Discovery Endpoint
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

  // Create Checkout Session
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
      createdAt: now,
      updatedAt: now,
      metadata: request.metadata,
    };

    sessions.set(sessionId, session);
    return c.json(session, 201);
  });

  // Get Checkout Session
  app.get("/ucp/checkout/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.get(sessionId);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json(session);
  });

  // Update Checkout Session
  app.patch("/ucp/checkout/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.get(sessionId);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const updates = await c.req.json();
    const updatedSession: CheckoutSession = {
      ...session,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    sessions.set(sessionId, updatedSession);
    return c.json(updatedSession);
  });

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}
