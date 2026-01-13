import type { PaymentHandler } from "./handler";
import type {
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
} from "./types";

/**
 * Mock payment handler for testing.
 * Simulates payment flows without real transactions.
 */
export class MockPaymentHandler implements PaymentHandler {
  readonly name = "mock";

  private paymentIntents = new Map<string, PaymentIntent>();
  private refunds = new Map<string, Refund>();
  private savedMethods = new Map<string, PaymentMethodInfo[]>();
  private idCounter = 0;

  // Test control flags
  public shouldFailPayment = false;
  public shouldRequireAction = false;
  public failureMessage = "Payment declined";

  private generateId(prefix: string): string {
    return `${prefix}_mock_${++this.idCounter}_${Date.now()}`;
  }

  async getAvailableMethods(customerId?: string): Promise<AvailablePaymentMethods> {
    const savedMethods = customerId ? this.savedMethods.get(customerId) || [] : [];

    return {
      methods: [
        { type: "card", name: "Credit/Debit Card", enabled: true },
        { type: "google_pay", name: "Google Pay", enabled: true },
        { type: "apple_pay", name: "Apple Pay", enabled: true },
        { type: "paypal", name: "PayPal", enabled: false },
      ],
      savedMethods,
    };
  }

  async createPaymentIntent(request: CreatePaymentRequest): Promise<PaymentIntent> {
    const id = this.generateId("pi");
    const now = new Date().toISOString();

    let status: PaymentStatus = "pending";
    let errorMessage: string | undefined;

    if (this.shouldFailPayment) {
      status = "failed";
      errorMessage = this.failureMessage;
    } else if (this.shouldRequireAction) {
      status = "requires_action";
    }

    const intent: PaymentIntent = {
      id,
      status,
      amount: request.amount,
      checkoutSessionId: request.checkoutSessionId,
      paymentMethodType: request.paymentMethodType,
      clientSecret: `${id}_secret_${Math.random().toString(36).slice(2)}`,
      errorMessage,
      createdAt: now,
      updatedAt: now,
      metadata: request.metadata,
    };

    this.paymentIntents.set(id, intent);
    return intent;
  }

  async confirmPayment(request: ConfirmPaymentRequest): Promise<PaymentIntent> {
    const intent = this.paymentIntents.get(request.paymentIntentId);
    if (!intent) {
      throw new Error(`Payment intent not found: ${request.paymentIntentId}`);
    }

    const now = new Date().toISOString();

    if (this.shouldFailPayment) {
      intent.status = "failed";
      intent.errorMessage = this.failureMessage;
    } else {
      intent.status = "authorized";
    }
    intent.updatedAt = now;

    // Simulate saving payment method
    if (request.savePaymentMethod && request.paymentToken) {
      // Would save the payment method here
    }

    return intent;
  }

  async capturePayment(request: CapturePaymentRequest): Promise<PaymentIntent> {
    const intent = this.paymentIntents.get(request.paymentIntentId);
    if (!intent) {
      throw new Error(`Payment intent not found: ${request.paymentIntentId}`);
    }

    if (intent.status !== "authorized") {
      throw new Error(`Cannot capture payment in status: ${intent.status}`);
    }

    const now = new Date().toISOString();

    if (request.amount) {
      // Partial capture
      intent.amount = request.amount;
    }

    intent.status = "captured";
    intent.capturedAt = now;
    intent.updatedAt = now;

    return intent;
  }

  async cancelPayment(paymentIntentId: string): Promise<PaymentIntent> {
    const intent = this.paymentIntents.get(paymentIntentId);
    if (!intent) {
      throw new Error(`Payment intent not found: ${paymentIntentId}`);
    }

    if (intent.status === "captured") {
      throw new Error("Cannot cancel captured payment, use refund instead");
    }

    intent.status = "cancelled";
    intent.updatedAt = new Date().toISOString();

    return intent;
  }

  async refund(request: RefundRequest): Promise<Refund> {
    const intent = this.paymentIntents.get(request.paymentIntentId);
    if (!intent) {
      throw new Error(`Payment intent not found: ${request.paymentIntentId}`);
    }

    if (intent.status !== "captured") {
      throw new Error(`Cannot refund payment in status: ${intent.status}`);
    }

    const refundId = this.generateId("re");
    const now = new Date().toISOString();

    const refund: Refund = {
      id: refundId,
      paymentIntentId: request.paymentIntentId,
      amount: request.amount || intent.amount,
      status: "succeeded",
      reason: request.reason,
      createdAt: now,
    };

    this.refunds.set(refundId, refund);

    // Update intent status
    if (!request.amount || request.amount.amount === intent.amount.amount) {
      intent.status = "refunded";
    } else {
      intent.status = "partially_refunded";
    }
    intent.updatedAt = now;

    return refund;
  }

  async getPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const intent = this.paymentIntents.get(paymentIntentId);
    if (!intent) {
      throw new Error(`Payment intent not found: ${paymentIntentId}`);
    }
    return intent;
  }

  async getSavedPaymentMethods(customerId: string): Promise<PaymentMethodInfo[]> {
    return this.savedMethods.get(customerId) || [];
  }

  async deletePaymentMethod(paymentMethodId: string): Promise<void> {
    // Find and remove from all customers
    for (const [customerId, methods] of this.savedMethods) {
      const filtered = methods.filter((m) => m.id !== paymentMethodId);
      if (filtered.length !== methods.length) {
        this.savedMethods.set(customerId, filtered);
        return;
      }
    }
    throw new Error(`Payment method not found: ${paymentMethodId}`);
  }

  async parseWebhookEvent(
    payload: string,
    signature: string
  ): Promise<PaymentWebhookEvent | null> {
    // Mock webhook verification - accept anything with valid JSON
    try {
      const data = JSON.parse(payload);
      return {
        id: this.generateId("evt"),
        type: data.type || "payment_intent.succeeded",
        paymentIntentId: data.paymentIntentId,
        data,
        createdAt: new Date().toISOString(),
        signature,
      };
    } catch {
      return null;
    }
  }

  // Test helpers
  addSavedPaymentMethod(customerId: string, method: PaymentMethodInfo): void {
    const existing = this.savedMethods.get(customerId) || [];
    existing.push(method);
    this.savedMethods.set(customerId, existing);
  }

  reset(): void {
    this.paymentIntents.clear();
    this.refunds.clear();
    this.savedMethods.clear();
    this.idCounter = 0;
    this.shouldFailPayment = false;
    this.shouldRequireAction = false;
    this.failureMessage = "Payment declined";
  }
}
