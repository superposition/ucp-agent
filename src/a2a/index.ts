import { z } from "zod";

// ============================================
// A2A PROTOCOL SCHEMAS
// ============================================

export const A2ACapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});

export const A2AAgentCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string(),
  endpoint: z.string().url(),
  capabilities: z.array(A2ACapabilitySchema),
  authentication: z.object({
    type: z.enum(["none", "api_key", "oauth2", "jwt"]),
    config: z.record(z.unknown()).optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const A2AMessageSchema = z.object({
  id: z.string(),
  type: z.enum(["request", "response", "error", "notification"]),
  from: z.string(),
  to: z.string(),
  capability: z.string(),
  payload: z.unknown(),
  correlationId: z.string().optional(),
  timestamp: z.string(),
});

export const A2AErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export type A2ACapability = z.infer<typeof A2ACapabilitySchema>;
export type A2AAgentCard = z.infer<typeof A2AAgentCardSchema>;
export type A2AMessage = z.infer<typeof A2AMessageSchema>;
export type A2AError = z.infer<typeof A2AErrorSchema>;

// ============================================
// A2A CLIENT
// ============================================

export interface A2AClientConfig {
  agentId: string;
  agentName: string;
  timeout?: number;
}

export class A2AClient {
  private config: A2AClientConfig;
  private discoveredAgents = new Map<string, A2AAgentCard>();

  constructor(config: A2AClientConfig) {
    this.config = config;
  }

  async discover(endpoint: string): Promise<A2AAgentCard> {
    const url = endpoint.endsWith("/.well-known/a2a")
      ? endpoint
      : `${endpoint}/.well-known/a2a`;

    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`A2A discovery failed: ${response.status}`);
    }

    const card = A2AAgentCardSchema.parse(await response.json());
    this.discoveredAgents.set(card.id, card);
    return card;
  }

  async invoke(
    agentId: string,
    capability: string,
    payload: unknown
  ): Promise<A2AMessage> {
    const agent = this.discoveredAgents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not discovered: ${agentId}`);
    }

    const cap = agent.capabilities.find((c) => c.id === capability);
    if (!cap) {
      throw new Error(`Capability not found: ${capability}`);
    }

    const message: A2AMessage = {
      id: crypto.randomUUID(),
      type: "request",
      from: this.config.agentId,
      to: agentId,
      capability,
      payload,
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(`${agent.endpoint}/a2a/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-A2A-Agent": this.config.agentId,
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`A2A invoke failed: ${error.message || response.status}`);
    }

    return A2AMessageSchema.parse(await response.json());
  }

  getDiscoveredAgents(): A2AAgentCard[] {
    return Array.from(this.discoveredAgents.values());
  }
}

// ============================================
// A2A SERVER
// ============================================

export type CapabilityHandler = (
  message: A2AMessage
) => Promise<unknown>;

export interface A2AServerConfig {
  agentId: string;
  agentName: string;
  description?: string;
  version?: string;
  endpoint: string;
}

export class A2AServer {
  private config: A2AServerConfig;
  private capabilities = new Map<string, { cap: A2ACapability; handler: CapabilityHandler }>();

  constructor(config: A2AServerConfig) {
    this.config = config;
  }

  registerCapability(
    capability: Omit<A2ACapability, "id">,
    handler: CapabilityHandler
  ): void {
    const id = `${this.config.agentId}.${capability.name}`;
    this.capabilities.set(id, {
      cap: { ...capability, id },
      handler,
    });
  }

  getAgentCard(): A2AAgentCard {
    return {
      id: this.config.agentId,
      name: this.config.agentName,
      description: this.config.description,
      version: this.config.version || "1.0.0",
      endpoint: this.config.endpoint,
      capabilities: Array.from(this.capabilities.values()).map((c) => c.cap),
    };
  }

  async handleInvoke(message: A2AMessage): Promise<A2AMessage> {
    const entry = this.capabilities.get(message.capability);

    if (!entry) {
      return {
        id: crypto.randomUUID(),
        type: "error",
        from: this.config.agentId,
        to: message.from,
        capability: message.capability,
        correlationId: message.id,
        payload: {
          code: "CAPABILITY_NOT_FOUND",
          message: `Capability not found: ${message.capability}`,
        },
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const result = await entry.handler(message);
      return {
        id: crypto.randomUUID(),
        type: "response",
        from: this.config.agentId,
        to: message.from,
        capability: message.capability,
        correlationId: message.id,
        payload: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        id: crypto.randomUUID(),
        type: "error",
        from: this.config.agentId,
        to: message.from,
        capability: message.capability,
        correlationId: message.id,
        payload: {
          code: "HANDLER_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// ============================================
// UCP A2A EXTENSION (Issue #14)
// ============================================

export const UCP_A2A_CAPABILITIES = {
  DISCOVER_MERCHANT: "ucp.discover",
  CREATE_CHECKOUT: "ucp.checkout.create",
  GET_CHECKOUT: "ucp.checkout.get",
  UPDATE_CHECKOUT: "ucp.checkout.update",
  COMPLETE_CHECKOUT: "ucp.checkout.complete",
  GET_ORDER: "ucp.order.get",
  TRACK_ORDER: "ucp.order.track",
} as const;

export function createUCPCapabilities(merchantEndpoint: string): A2ACapability[] {
  return [
    {
      id: UCP_A2A_CAPABILITIES.DISCOVER_MERCHANT,
      name: "discover",
      description: "Discover UCP merchant capabilities",
      version: "1.0.0",
    },
    {
      id: UCP_A2A_CAPABILITIES.CREATE_CHECKOUT,
      name: "checkout.create",
      description: "Create a new checkout session",
      version: "1.0.0",
      inputSchema: {
        type: "object",
        properties: {
          merchantId: { type: "string" },
          items: { type: "array" },
          customer: { type: "object" },
        },
        required: ["merchantId", "items"],
      },
    },
    {
      id: UCP_A2A_CAPABILITIES.GET_CHECKOUT,
      name: "checkout.get",
      description: "Get checkout session details",
      version: "1.0.0",
      inputSchema: {
        type: "object",
        properties: { sessionId: { type: "string" } },
        required: ["sessionId"],
      },
    },
    {
      id: UCP_A2A_CAPABILITIES.UPDATE_CHECKOUT,
      name: "checkout.update",
      description: "Update checkout session",
      version: "1.0.0",
    },
    {
      id: UCP_A2A_CAPABILITIES.COMPLETE_CHECKOUT,
      name: "checkout.complete",
      description: "Complete checkout with payment",
      version: "1.0.0",
    },
    {
      id: UCP_A2A_CAPABILITIES.GET_ORDER,
      name: "order.get",
      description: "Get order details",
      version: "1.0.0",
    },
    {
      id: UCP_A2A_CAPABILITIES.TRACK_ORDER,
      name: "order.track",
      description: "Track order status",
      version: "1.0.0",
    },
  ];
}

export function createUCPA2AServer(
  config: A2AServerConfig,
  merchantEndpoint: string
): A2AServer {
  const server = new A2AServer(config);

  // Register UCP capabilities
  server.registerCapability(
    { name: "discover", description: "Discover merchant", version: "1.0.0" },
    async () => {
      const res = await fetch(`${merchantEndpoint}/.well-known/ucp`);
      return res.json();
    }
  );

  server.registerCapability(
    { name: "checkout.create", description: "Create checkout", version: "1.0.0" },
    async (msg) => {
      const res = await fetch(`${merchantEndpoint}/ucp/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg.payload),
      });
      return res.json();
    }
  );

  server.registerCapability(
    { name: "checkout.get", description: "Get checkout", version: "1.0.0" },
    async (msg) => {
      const { sessionId } = msg.payload as { sessionId: string };
      const res = await fetch(`${merchantEndpoint}/ucp/checkout/${sessionId}`);
      return res.json();
    }
  );

  server.registerCapability(
    { name: "order.get", description: "Get order", version: "1.0.0" },
    async (msg) => {
      const { orderId } = msg.payload as { orderId: string };
      const res = await fetch(`${merchantEndpoint}/ucp/orders/${orderId}`);
      return res.json();
    }
  );

  return server;
}
