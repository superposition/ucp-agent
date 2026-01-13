import type { Money } from "../sdk";

// Payment method types supported
export type PaymentMethodType =
  | "card"
  | "google_pay"
  | "apple_pay"
  | "paypal"
  | "bank_transfer"
  | "crypto";

// Payment status
export type PaymentStatus =
  | "pending"
  | "requires_action"
  | "processing"
  | "authorized"
  | "captured"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

// Card details (for display, not full card number)
export interface CardDetails {
  brand: string; // visa, mastercard, amex, etc.
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  funding?: "credit" | "debit" | "prepaid" | "unknown";
}

// Payment method info
export interface PaymentMethodInfo {
  id: string;
  type: PaymentMethodType;
  card?: CardDetails;
  billingEmail?: string;
  isDefault?: boolean;
  createdAt: string;
}

// Create payment intent request
export interface CreatePaymentRequest {
  amount: Money;
  checkoutSessionId: string;
  customerId?: string;
  customerEmail?: string;
  paymentMethodType: PaymentMethodType;
  returnUrl?: string; // For redirect-based payments
  metadata?: Record<string, string>;
}

// Payment intent/transaction
export interface PaymentIntent {
  id: string;
  status: PaymentStatus;
  amount: Money;
  checkoutSessionId: string;
  paymentMethodType: PaymentMethodType;
  clientSecret?: string; // For client-side confirmation
  redirectUrl?: string; // For redirect-based flows
  errorMessage?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
  capturedAt?: string;
  metadata?: Record<string, string>;
}

// Confirm payment request
export interface ConfirmPaymentRequest {
  paymentIntentId: string;
  paymentMethodId?: string; // Saved payment method
  paymentToken?: string; // One-time token from client
  savePaymentMethod?: boolean;
}

// Capture payment request (for auth-then-capture flow)
export interface CapturePaymentRequest {
  paymentIntentId: string;
  amount?: Money; // Partial capture
}

// Refund request
export interface RefundRequest {
  paymentIntentId: string;
  amount?: Money; // Partial refund if specified
  reason?: string;
}

// Refund result
export interface Refund {
  id: string;
  paymentIntentId: string;
  amount: Money;
  status: "pending" | "succeeded" | "failed";
  reason?: string;
  createdAt: string;
}

// Webhook event from payment provider
export interface PaymentWebhookEvent {
  id: string;
  type: string;
  paymentIntentId?: string;
  data: Record<string, unknown>;
  createdAt: string;
  signature?: string;
}

// Payment handler configuration
export interface PaymentHandlerConfig {
  apiKey: string;
  webhookSecret?: string;
  testMode?: boolean;
}

// Available payment methods response
export interface AvailablePaymentMethods {
  methods: {
    type: PaymentMethodType;
    name: string;
    icon?: string;
    enabled: boolean;
  }[];
  savedMethods?: PaymentMethodInfo[];
}
