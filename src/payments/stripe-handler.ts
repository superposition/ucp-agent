import type { PaymentHandler } from "./handler";
import type {
  PaymentHandlerConfig,
  CreatePaymentRequest,
  PaymentIntent,
  ConfirmPaymentRequest,
  CapturePaymentRequest,
  RefundRequest,
  Refund,
  PaymentWebhookEvent,
  AvailablePaymentMethods,
  PaymentMethodInfo,
  PaymentStatus,
  PaymentMethodType,
} from "./types";

/**
 * Stripe payment handler.
 * Integrates with Stripe API for payment processing.
 */
export class StripePaymentHandler implements PaymentHandler {
  readonly name = "stripe";
  private apiKey: string;
  private webhookSecret?: string;
  private baseUrl = "https://api.stripe.com/v1";

  constructor(config: PaymentHandlerConfig) {
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret;
    if (config.testMode) {
      // Stripe uses same API for test mode, just different keys
    }
  }

  private async stripeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || `Stripe error: ${response.status}`);
    }

    return data as T;
  }

  private toFormData(obj: Record<string, unknown>): string {
    const params = new URLSearchParams();

    const flatten = (data: unknown, prefix = ""): void => {
      if (data === null || data === undefined) return;

      if (typeof data === "object" && !Array.isArray(data)) {
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
          flatten(value, prefix ? `${prefix}[${key}]` : key);
        }
      } else if (Array.isArray(data)) {
        data.forEach((item, index) => {
          flatten(item, `${prefix}[${index}]`);
        });
      } else {
        params.append(prefix, String(data));
      }
    };

    flatten(obj);
    return params.toString();
  }

  private mapStripeStatus(stripeStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      requires_payment_method: "pending",
      requires_confirmation: "pending",
      requires_action: "requires_action",
      processing: "processing",
      requires_capture: "authorized",
      canceled: "cancelled",
      succeeded: "captured",
    };
    return statusMap[stripeStatus] || "pending";
  }

  private mapPaymentMethodType(type: PaymentMethodType): string {
    const typeMap: Record<PaymentMethodType, string> = {
      card: "card",
      google_pay: "card", // Stripe handles Google Pay through card
      apple_pay: "card", // Stripe handles Apple Pay through card
      paypal: "paypal",
      bank_transfer: "us_bank_account",
      crypto: "crypto",
    };
    return typeMap[type] || "card";
  }

  async getAvailableMethods(customerId?: string): Promise<AvailablePaymentMethods> {
    const methods: AvailablePaymentMethods = {
      methods: [
        { type: "card", name: "Credit/Debit Card", enabled: true },
        { type: "google_pay", name: "Google Pay", enabled: true },
        { type: "apple_pay", name: "Apple Pay", enabled: true },
      ],
    };

    if (customerId) {
      try {
        const savedMethods = await this.getSavedPaymentMethods(customerId);
        methods.savedMethods = savedMethods;
      } catch {
        // Customer might not exist in Stripe yet
      }
    }

    return methods;
  }

  async createPaymentIntent(request: CreatePaymentRequest): Promise<PaymentIntent> {
    // Convert amount to cents (Stripe uses smallest currency unit)
    const amountInCents = Math.round(parseFloat(request.amount.amount) * 100);

    const params: Record<string, unknown> = {
      amount: amountInCents,
      currency: request.amount.currency.toLowerCase(),
      payment_method_types: [this.mapPaymentMethodType(request.paymentMethodType)],
      capture_method: "automatic", // or "manual" for auth-then-capture
      metadata: {
        checkout_session_id: request.checkoutSessionId,
        ...request.metadata,
      },
    };

    if (request.customerId) {
      params.customer = request.customerId;
    }

    if (request.customerEmail) {
      params.receipt_email = request.customerEmail;
    }

    if (request.returnUrl) {
      params.return_url = request.returnUrl;
    }

    const stripeIntent = await this.stripeRequest<{
      id: string;
      status: string;
      client_secret: string;
      amount: number;
      currency: string;
      created: number;
      metadata: Record<string, string>;
      last_payment_error?: { message: string; code: string };
    }>("/payment_intents", {
      method: "POST",
      body: this.toFormData(params),
    });

    return {
      id: stripeIntent.id,
      status: this.mapStripeStatus(stripeIntent.status),
      amount: {
        amount: (stripeIntent.amount / 100).toFixed(2),
        currency: stripeIntent.currency.toUpperCase(),
      },
      checkoutSessionId: request.checkoutSessionId,
      paymentMethodType: request.paymentMethodType,
      clientSecret: stripeIntent.client_secret,
      errorMessage: stripeIntent.last_payment_error?.message,
      errorCode: stripeIntent.last_payment_error?.code,
      createdAt: new Date(stripeIntent.created * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: stripeIntent.metadata,
    };
  }

  async confirmPayment(request: ConfirmPaymentRequest): Promise<PaymentIntent> {
    const params: Record<string, unknown> = {};

    if (request.paymentMethodId) {
      params.payment_method = request.paymentMethodId;
    }

    // Note: paymentToken would typically be handled client-side with Stripe.js
    // The server just confirms after client-side token creation

    const stripeIntent = await this.stripeRequest<{
      id: string;
      status: string;
      client_secret: string;
      amount: number;
      currency: string;
      created: number;
      metadata: Record<string, string>;
      last_payment_error?: { message: string; code: string };
      charges?: { data: Array<{ captured: boolean }> };
    }>(`/payment_intents/${request.paymentIntentId}/confirm`, {
      method: "POST",
      body: this.toFormData(params),
    });

    const capturedAt =
      stripeIntent.status === "succeeded"
        ? new Date().toISOString()
        : undefined;

    return {
      id: stripeIntent.id,
      status: this.mapStripeStatus(stripeIntent.status),
      amount: {
        amount: (stripeIntent.amount / 100).toFixed(2),
        currency: stripeIntent.currency.toUpperCase(),
      },
      checkoutSessionId: stripeIntent.metadata?.checkout_session_id || "",
      paymentMethodType: "card",
      clientSecret: stripeIntent.client_secret,
      errorMessage: stripeIntent.last_payment_error?.message,
      errorCode: stripeIntent.last_payment_error?.code,
      createdAt: new Date(stripeIntent.created * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      capturedAt,
      metadata: stripeIntent.metadata,
    };
  }

  async capturePayment(request: CapturePaymentRequest): Promise<PaymentIntent> {
    const params: Record<string, unknown> = {};

    if (request.amount) {
      params.amount_to_capture = Math.round(
        parseFloat(request.amount.amount) * 100
      );
    }

    const stripeIntent = await this.stripeRequest<{
      id: string;
      status: string;
      amount: number;
      amount_capturable: number;
      currency: string;
      created: number;
      metadata: Record<string, string>;
    }>(`/payment_intents/${request.paymentIntentId}/capture`, {
      method: "POST",
      body: this.toFormData(params),
    });

    return {
      id: stripeIntent.id,
      status: this.mapStripeStatus(stripeIntent.status),
      amount: {
        amount: (stripeIntent.amount / 100).toFixed(2),
        currency: stripeIntent.currency.toUpperCase(),
      },
      checkoutSessionId: stripeIntent.metadata?.checkout_session_id || "",
      paymentMethodType: "card",
      createdAt: new Date(stripeIntent.created * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      capturedAt: new Date().toISOString(),
      metadata: stripeIntent.metadata,
    };
  }

  async cancelPayment(paymentIntentId: string): Promise<PaymentIntent> {
    const stripeIntent = await this.stripeRequest<{
      id: string;
      status: string;
      amount: number;
      currency: string;
      created: number;
      metadata: Record<string, string>;
    }>(`/payment_intents/${paymentIntentId}/cancel`, {
      method: "POST",
    });

    return {
      id: stripeIntent.id,
      status: this.mapStripeStatus(stripeIntent.status),
      amount: {
        amount: (stripeIntent.amount / 100).toFixed(2),
        currency: stripeIntent.currency.toUpperCase(),
      },
      checkoutSessionId: stripeIntent.metadata?.checkout_session_id || "",
      paymentMethodType: "card",
      createdAt: new Date(stripeIntent.created * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: stripeIntent.metadata,
    };
  }

  async refund(request: RefundRequest): Promise<Refund> {
    const params: Record<string, unknown> = {
      payment_intent: request.paymentIntentId,
    };

    if (request.amount) {
      params.amount = Math.round(parseFloat(request.amount.amount) * 100);
    }

    if (request.reason) {
      params.reason = request.reason;
    }

    const stripeRefund = await this.stripeRequest<{
      id: string;
      amount: number;
      currency: string;
      status: string;
      reason: string | null;
      created: number;
    }>("/refunds", {
      method: "POST",
      body: this.toFormData(params),
    });

    return {
      id: stripeRefund.id,
      paymentIntentId: request.paymentIntentId,
      amount: {
        amount: (stripeRefund.amount / 100).toFixed(2),
        currency: stripeRefund.currency.toUpperCase(),
      },
      status: stripeRefund.status === "succeeded" ? "succeeded" : "pending",
      reason: stripeRefund.reason || undefined,
      createdAt: new Date(stripeRefund.created * 1000).toISOString(),
    };
  }

  async getPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const stripeIntent = await this.stripeRequest<{
      id: string;
      status: string;
      client_secret: string;
      amount: number;
      currency: string;
      created: number;
      metadata: Record<string, string>;
      last_payment_error?: { message: string; code: string };
    }>(`/payment_intents/${paymentIntentId}`);

    return {
      id: stripeIntent.id,
      status: this.mapStripeStatus(stripeIntent.status),
      amount: {
        amount: (stripeIntent.amount / 100).toFixed(2),
        currency: stripeIntent.currency.toUpperCase(),
      },
      checkoutSessionId: stripeIntent.metadata?.checkout_session_id || "",
      paymentMethodType: "card",
      clientSecret: stripeIntent.client_secret,
      errorMessage: stripeIntent.last_payment_error?.message,
      errorCode: stripeIntent.last_payment_error?.code,
      createdAt: new Date(stripeIntent.created * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: stripeIntent.metadata,
    };
  }

  async getSavedPaymentMethods(customerId: string): Promise<PaymentMethodInfo[]> {
    const response = await this.stripeRequest<{
      data: Array<{
        id: string;
        type: string;
        created: number;
        card?: {
          brand: string;
          last4: string;
          exp_month: number;
          exp_year: number;
          funding: string;
        };
        billing_details?: {
          email: string;
        };
      }>;
    }>(`/payment_methods?customer=${customerId}&type=card`);

    return response.data.map((pm) => ({
      id: pm.id,
      type: "card" as PaymentMethodType,
      card: pm.card
        ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expiryMonth: pm.card.exp_month,
            expiryYear: pm.card.exp_year,
            funding: pm.card.funding as "credit" | "debit" | "prepaid" | "unknown",
          }
        : undefined,
      billingEmail: pm.billing_details?.email,
      createdAt: new Date(pm.created * 1000).toISOString(),
    }));
  }

  async deletePaymentMethod(paymentMethodId: string): Promise<void> {
    await this.stripeRequest(`/payment_methods/${paymentMethodId}/detach`, {
      method: "POST",
    });
  }

  async parseWebhookEvent(
    payload: string,
    signature: string
  ): Promise<PaymentWebhookEvent | null> {
    if (!this.webhookSecret) {
      throw new Error("Webhook secret not configured");
    }

    // Verify signature using Stripe's signing scheme
    // In production, use Stripe's official library for this
    const parts = signature.split(",");
    const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
    const sig = parts.find((p) => p.startsWith("v1="))?.slice(3);

    if (!timestamp || !sig) {
      return null;
    }

    // Verify timestamp is recent (within 5 minutes)
    const eventTime = parseInt(timestamp) * 1000;
    if (Date.now() - eventTime > 300000) {
      return null;
    }

    // In production, compute HMAC and compare
    // For now, we'll trust the signature format

    try {
      const event = JSON.parse(payload);
      return {
        id: event.id,
        type: event.type,
        paymentIntentId: event.data?.object?.id,
        data: event.data?.object || {},
        createdAt: new Date(event.created * 1000).toISOString(),
        signature,
      };
    } catch {
      return null;
    }
  }
}
