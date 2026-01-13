import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type {
  CreateCheckoutRequest,
  CheckoutSession,
  UCPDiscoveryResponse,
  Cart,
  Customer,
} from "../sdk";
import { PromptSanitizer, type SanitizerConfig, type SanitizationResult } from "./sanitizer";

export interface UCPAgentConfig {
  anthropicApiKey: string;
  merchantEndpoint: string;
  model?: string;
  sanitizerConfig?: SanitizerConfig;
  onSanitizationViolation?: (input: string, result: SanitizationResult) => void;
}

const SYSTEM_PROMPT = `You are a UCP (Universal Commerce Protocol) shopping assistant agent. You help users discover products, manage their cart, and complete purchases through UCP-compliant merchants.

When a user wants to make a purchase, guide them through:
1. First discover what the merchant supports using discover_merchant
2. Help them build their cart
3. Create a checkout session using create_checkout
4. Collect necessary information (shipping, billing) using update_checkout
5. Get checkout status using get_checkout

Always be helpful, clear about pricing, and transparent about the checkout process.
Use the tools provided to interact with the merchant's UCP endpoints.`;

// Define tools for Claude to use
const UCP_TOOLS: Tool[] = [
  {
    name: "discover_merchant",
    description: "Discover the merchant's UCP capabilities by querying /.well-known/ucp. Call this first to understand what the merchant supports.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "create_checkout",
    description: "Create a new checkout session with items in the cart. Returns a session ID for further operations.",
    input_schema: {
      type: "object" as const,
      properties: {
        items: {
          type: "array",
          description: "Items to add to the cart",
          items: {
            type: "object",
            properties: {
              productId: { type: "string", description: "Product identifier" },
              name: { type: "string", description: "Product name" },
              quantity: { type: "number", description: "Quantity to purchase" },
              unitPriceAmount: { type: "string", description: "Unit price as decimal string (e.g., '29.99')" },
              currency: { type: "string", description: "Currency code (e.g., 'USD')" },
            },
            required: ["productId", "name", "quantity", "unitPriceAmount", "currency"],
          },
        },
        customerName: { type: "string", description: "Customer's name" },
        customerEmail: { type: "string", description: "Customer's email address" },
      },
      required: ["items"],
    },
  },
  {
    name: "get_checkout",
    description: "Get the current status and details of a checkout session.",
    input_schema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "The checkout session ID" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "update_checkout",
    description: "Update a checkout session with shipping address or discount code.",
    input_schema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "The checkout session ID" },
        shippingAddress: {
          type: "object",
          description: "Shipping address",
          properties: {
            line1: { type: "string" },
            line2: { type: "string" },
            city: { type: "string" },
            region: { type: "string" },
            postalCode: { type: "string" },
            country: { type: "string", description: "2-letter country code" },
          },
          required: ["line1", "city", "postalCode", "country"],
        },
        discountCode: { type: "string", description: "Promotional discount code" },
      },
      required: ["sessionId"],
    },
  },
];

interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceAmount: string;
  currency: string;
}

interface CreateCheckoutInput {
  items: CartItem[];
  customerName?: string;
  customerEmail?: string;
}

interface GetCheckoutInput {
  sessionId: string;
}

interface UpdateCheckoutInput {
  sessionId: string;
  shippingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode: string;
    country: string;
  };
  discountCode?: string;
}

export class UCPClaudeAgent {
  private client: Anthropic;
  private config: UCPAgentConfig;
  private conversationHistory: MessageParam[] = [];
  private currentSession: CheckoutSession | null = null;
  private merchantCapabilities: UCPDiscoveryResponse | null = null;
  private sanitizer: PromptSanitizer;

  constructor(config: UCPAgentConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
    this.sanitizer = new PromptSanitizer(config.sanitizerConfig);
  }

  async discoverMerchant(): Promise<UCPDiscoveryResponse> {
    const response = await fetch(
      `${this.config.merchantEndpoint}/.well-known/ucp`
    );
    if (!response.ok) {
      throw new Error(`Discovery failed: ${response.statusText}`);
    }
    const data = (await response.json()) as UCPDiscoveryResponse;
    this.merchantCapabilities = data;
    return data;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    // Build cart from input items
    let subtotal = 0;
    const lineItems = input.items.map((item, index) => {
      const itemTotal = parseFloat(item.unitPriceAmount) * item.quantity;
      subtotal += itemTotal;
      return {
        id: `item-${index}`,
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: { amount: item.unitPriceAmount, currency: item.currency },
        totalPrice: { amount: itemTotal.toFixed(2), currency: item.currency },
      };
    });

    const currency = input.items[0]?.currency || "USD";
    const cart: Cart = {
      items: lineItems,
      subtotal: { amount: subtotal.toFixed(2), currency },
      total: { amount: subtotal.toFixed(2), currency },
    };

    const request: CreateCheckoutRequest = {
      merchantId: this.merchantCapabilities?.merchantId || "default-merchant",
      cart,
      customer: input.customerName || input.customerEmail
        ? {
            contact: {
              name: input.customerName || "Customer",
              email: input.customerEmail,
            },
          }
        : undefined,
    };

    const response = await fetch(
      `${this.config.merchantEndpoint}/ucp/checkout`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "UCP-Agent": "claude-ucp-agent/1.0",
        },
        body: JSON.stringify(request),
      }
    );
    if (!response.ok) {
      throw new Error(`Checkout creation failed: ${response.statusText}`);
    }
    const session = (await response.json()) as CheckoutSession;
    this.currentSession = session;
    return session;
  }

  async getCheckout(sessionId: string): Promise<CheckoutSession> {
    const response = await fetch(
      `${this.config.merchantEndpoint}/ucp/checkout/${sessionId}`
    );
    if (!response.ok) {
      throw new Error(`Get checkout failed: ${response.statusText}`);
    }
    return (await response.json()) as CheckoutSession;
  }

  async updateCheckout(input: UpdateCheckoutInput): Promise<CheckoutSession> {
    const response = await fetch(
      `${this.config.merchantEndpoint}/ucp/checkout/${input.sessionId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shippingAddress: input.shippingAddress,
          discountCode: input.discountCode,
        }),
      }
    );
    if (!response.ok) {
      throw new Error(`Update checkout failed: ${response.statusText}`);
    }
    const session = (await response.json()) as CheckoutSession;
    this.currentSession = session;
    return session;
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    try {
      switch (name) {
        case "discover_merchant": {
          const result = await this.discoverMerchant();
          return JSON.stringify(result, null, 2);
        }
        case "create_checkout": {
          const result = await this.createCheckout(input as unknown as CreateCheckoutInput);
          return JSON.stringify(result, null, 2);
        }
        case "get_checkout": {
          const { sessionId } = input as unknown as GetCheckoutInput;
          const result = await this.getCheckout(sessionId);
          return JSON.stringify(result, null, 2);
        }
        case "update_checkout": {
          const result = await this.updateCheckout(input as unknown as UpdateCheckoutInput);
          return JSON.stringify(result, null, 2);
        }
        default:
          return JSON.stringify({ error: `Unknown tool: ${name}` });
      }
    } catch (error) {
      return JSON.stringify({ error: String(error) });
    }
  }

  async chat(userMessage: string): Promise<string> {
    // Sanitize user input before processing
    const sanitizationResult = this.sanitizer.sanitize(userMessage);

    if (!sanitizationResult.safe) {
      // Log the violation if callback provided
      if (this.config.onSanitizationViolation) {
        this.config.onSanitizationViolation(userMessage, sanitizationResult);
      } else {
        PromptSanitizer.logViolation(userMessage, sanitizationResult);
      }
      return PromptSanitizer.getRejectionMessage();
    }

    // Use sanitized input (normalized unicode, trimmed length)
    const safeMessage = sanitizationResult.sanitized;

    // Add user message to history
    this.conversationHistory.push({
      role: "user",
      content: safeMessage,
    });

    let response = await this.client.messages.create({
      model: this.config.model || "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: UCP_TOOLS,
      messages: this.conversationHistory,
    });

    // Process tool calls in a loop until we get a final response
    while (response.stop_reason === "tool_use") {
      const assistantContent = response.content;

      // Add assistant's response (with tool use) to history
      this.conversationHistory.push({
        role: "assistant",
        content: assistantContent,
      });

      // Execute all tool calls and collect results
      const toolResults: ToolResultBlockParam[] = [];
      for (const block of assistantContent) {
        if (block.type === "tool_use") {
          const toolUse = block as ToolUseBlock;
          const result = await this.executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        }
      }

      // Add tool results to history
      this.conversationHistory.push({
        role: "user",
        content: toolResults,
      });

      // Continue the conversation
      response = await this.client.messages.create({
        model: this.config.model || "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: UCP_TOOLS,
        messages: this.conversationHistory,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter((b) => b.type === "text");
    const finalText = textBlocks.map((b) => (b as { type: "text"; text: string }).text).join("\n");

    // Add final response to history
    this.conversationHistory.push({
      role: "assistant",
      content: response.content,
    });

    return finalText;
  }

  getSession(): CheckoutSession | null {
    return this.currentSession;
  }

  getCapabilities(): UCPDiscoveryResponse | null {
    return this.merchantCapabilities;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }
}
