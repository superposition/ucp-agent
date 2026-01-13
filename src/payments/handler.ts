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
} from "./types";

/**
 * Abstract payment handler interface.
 * Implement this for each payment provider (Stripe, PayPal, etc.)
 */
export interface PaymentHandler {
  /** Provider name (e.g., "stripe", "paypal") */
  readonly name: string;

  /**
   * Get available payment methods for a checkout.
   * May include saved payment methods for returning customers.
   */
  getAvailableMethods(customerId?: string): Promise<AvailablePaymentMethods>;

  /**
   * Create a payment intent for the given amount.
   * Returns client secret for frontend confirmation.
   */
  createPaymentIntent(request: CreatePaymentRequest): Promise<PaymentIntent>;

  /**
   * Confirm a payment with the provided payment method.
   * Called after customer enters payment details.
   */
  confirmPayment(request: ConfirmPaymentRequest): Promise<PaymentIntent>;

  /**
   * Capture a previously authorized payment.
   * For auth-then-capture flows.
   */
  capturePayment(request: CapturePaymentRequest): Promise<PaymentIntent>;

  /**
   * Cancel/void a payment intent.
   */
  cancelPayment(paymentIntentId: string): Promise<PaymentIntent>;

  /**
   * Issue a refund for a captured payment.
   */
  refund(request: RefundRequest): Promise<Refund>;

  /**
   * Get payment intent by ID.
   */
  getPaymentIntent(paymentIntentId: string): Promise<PaymentIntent>;

  /**
   * Get saved payment methods for a customer.
   */
  getSavedPaymentMethods(customerId: string): Promise<PaymentMethodInfo[]>;

  /**
   * Delete a saved payment method.
   */
  deletePaymentMethod(paymentMethodId: string): Promise<void>;

  /**
   * Verify and parse a webhook event.
   * Returns null if signature is invalid.
   */
  parseWebhookEvent(
    payload: string,
    signature: string
  ): Promise<PaymentWebhookEvent | null>;
}

/**
 * Payment handler registry.
 * Register handlers and retrieve by name.
 */
export class PaymentHandlerRegistry {
  private handlers = new Map<string, PaymentHandler>();
  private defaultHandler: string | null = null;

  register(handler: PaymentHandler, isDefault = false): void {
    this.handlers.set(handler.name, handler);
    if (isDefault || this.handlers.size === 1) {
      this.defaultHandler = handler.name;
    }
  }

  get(name: string): PaymentHandler | undefined {
    return this.handlers.get(name);
  }

  getDefault(): PaymentHandler | undefined {
    if (this.defaultHandler) {
      return this.handlers.get(this.defaultHandler);
    }
    return undefined;
  }

  setDefault(name: string): void {
    if (!this.handlers.has(name)) {
      throw new Error(`Payment handler '${name}' not registered`);
    }
    this.defaultHandler = name;
  }

  list(): string[] {
    return Array.from(this.handlers.keys());
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }
}

// Global registry instance
export const paymentHandlers = new PaymentHandlerRegistry();
