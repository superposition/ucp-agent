import { z } from "zod";
import { CheckoutSessionSchema } from "./checkout";
import { OrderSchema } from "./order";
import { ShipmentSchema, ReturnRequestSchema } from "./fulfillment";
import { AppliedDiscountSchema } from "./discount";

// Webhook event types
export const WebhookEventTypeSchema = z.enum([
  // Checkout events
  "checkout.session.created",
  "checkout.session.updated",
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.cancelled",

  // Order events
  "order.created",
  "order.confirmed",
  "order.updated",
  "order.cancelled",
  "order.completed",

  // Payment events
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "payment.refunded",
  "payment.partially_refunded",

  // Fulfillment events
  "shipment.created",
  "shipment.updated",
  "shipment.shipped",
  "shipment.delivered",
  "shipment.failed",

  // Return events
  "return.requested",
  "return.approved",
  "return.rejected",
  "return.received",
  "return.refunded",

  // Customer events
  "customer.created",
  "customer.updated",
  "identity.linked",
  "identity.unlinked",

  // Discount events
  "discount.applied",
  "discount.removed",
  "discount.expired",
]);

// Base webhook event structure
export const WebhookEventBaseSchema = z.object({
  id: z.string().describe("Unique event ID"),
  type: WebhookEventTypeSchema,
  apiVersion: z.string().default("1.0.0"),
  createdAt: z.string().datetime(),
  merchantId: z.string(),

  // Idempotency
  idempotencyKey: z.string().optional(),

  // For retries
  attemptNumber: z.number().int().positive().default(1),
  previousAttemptAt: z.string().datetime().optional(),
});

// Checkout events
export const CheckoutEventPayloadSchema = z.object({
  session: CheckoutSessionSchema,
  previousStatus: z.string().optional(),
});

// Order events
export const OrderEventPayloadSchema = z.object({
  order: OrderSchema,
  previousStatus: z.string().optional(),
  changedFields: z.array(z.string()).optional(),
});

// Payment events
export const PaymentEventPayloadSchema = z.object({
  orderId: z.string(),
  paymentId: z.string(),
  amount: z.object({
    amount: z.string(),
    currency: z.string(),
  }),
  transactionId: z.string().optional(),
  failureReason: z.string().optional(),
});

// Shipment events
export const ShipmentEventPayloadSchema = z.object({
  shipment: ShipmentSchema,
  previousStatus: z.string().optional(),
});

// Return events
export const ReturnEventPayloadSchema = z.object({
  returnRequest: ReturnRequestSchema,
  previousStatus: z.string().optional(),
});

// Customer events
export const CustomerEventPayloadSchema = z.object({
  customerId: z.string(),
  email: z.string().email().optional(),
  changedFields: z.array(z.string()).optional(),
});

// Identity events
export const IdentityEventPayloadSchema = z.object({
  customerId: z.string(),
  provider: z.string(),
  providerId: z.string(),
});

// Discount events
export const DiscountEventPayloadSchema = z.object({
  sessionId: z.string().optional(),
  orderId: z.string().optional(),
  discount: AppliedDiscountSchema,
});

// Full webhook event (discriminated union by type)
export const WebhookEventSchema = z.discriminatedUnion("type", [
  // Checkout events
  WebhookEventBaseSchema.extend({
    type: z.literal("checkout.session.created"),
    data: CheckoutEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("checkout.session.updated"),
    data: CheckoutEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("checkout.session.completed"),
    data: CheckoutEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("checkout.session.expired"),
    data: CheckoutEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("checkout.session.cancelled"),
    data: CheckoutEventPayloadSchema,
  }),

  // Order events
  WebhookEventBaseSchema.extend({
    type: z.literal("order.created"),
    data: OrderEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("order.confirmed"),
    data: OrderEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("order.updated"),
    data: OrderEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("order.cancelled"),
    data: OrderEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("order.completed"),
    data: OrderEventPayloadSchema,
  }),

  // Payment events
  WebhookEventBaseSchema.extend({
    type: z.literal("payment.authorized"),
    data: PaymentEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("payment.captured"),
    data: PaymentEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("payment.failed"),
    data: PaymentEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("payment.refunded"),
    data: PaymentEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("payment.partially_refunded"),
    data: PaymentEventPayloadSchema,
  }),

  // Shipment events
  WebhookEventBaseSchema.extend({
    type: z.literal("shipment.created"),
    data: ShipmentEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("shipment.updated"),
    data: ShipmentEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("shipment.shipped"),
    data: ShipmentEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("shipment.delivered"),
    data: ShipmentEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("shipment.failed"),
    data: ShipmentEventPayloadSchema,
  }),

  // Return events
  WebhookEventBaseSchema.extend({
    type: z.literal("return.requested"),
    data: ReturnEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("return.approved"),
    data: ReturnEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("return.rejected"),
    data: ReturnEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("return.received"),
    data: ReturnEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("return.refunded"),
    data: ReturnEventPayloadSchema,
  }),

  // Customer events
  WebhookEventBaseSchema.extend({
    type: z.literal("customer.created"),
    data: CustomerEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("customer.updated"),
    data: CustomerEventPayloadSchema,
  }),

  // Identity events
  WebhookEventBaseSchema.extend({
    type: z.literal("identity.linked"),
    data: IdentityEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("identity.unlinked"),
    data: IdentityEventPayloadSchema,
  }),

  // Discount events
  WebhookEventBaseSchema.extend({
    type: z.literal("discount.applied"),
    data: DiscountEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("discount.removed"),
    data: DiscountEventPayloadSchema,
  }),
  WebhookEventBaseSchema.extend({
    type: z.literal("discount.expired"),
    data: DiscountEventPayloadSchema,
  }),
]);

// Webhook endpoint configuration
export const WebhookEndpointSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  events: z.array(WebhookEventTypeSchema),
  secret: z.string().describe("Signing secret for verification"),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
});

// Webhook delivery attempt
export const WebhookDeliveryAttemptSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  endpointId: z.string(),
  attemptNumber: z.number().int().positive(),
  requestedAt: z.string().datetime(),
  respondedAt: z.string().datetime().optional(),
  responseStatus: z.number().int().optional(),
  responseBody: z.string().optional(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

// Webhook signature header
export const WebhookSignatureSchema = z.object({
  timestamp: z.number().int(),
  signature: z.string(),
  algorithm: z.enum(["sha256", "sha512"]).default("sha256"),
});

// Type exports
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;
export type WebhookEventBase = z.infer<typeof WebhookEventBaseSchema>;
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type CheckoutEventPayload = z.infer<typeof CheckoutEventPayloadSchema>;
export type OrderEventPayload = z.infer<typeof OrderEventPayloadSchema>;
export type PaymentEventPayload = z.infer<typeof PaymentEventPayloadSchema>;
export type ShipmentEventPayload = z.infer<typeof ShipmentEventPayloadSchema>;
export type ReturnEventPayload = z.infer<typeof ReturnEventPayloadSchema>;
export type CustomerEventPayload = z.infer<typeof CustomerEventPayloadSchema>;
export type IdentityEventPayload = z.infer<typeof IdentityEventPayloadSchema>;
export type DiscountEventPayload = z.infer<typeof DiscountEventPayloadSchema>;
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;
export type WebhookDeliveryAttempt = z.infer<typeof WebhookDeliveryAttemptSchema>;
export type WebhookSignature = z.infer<typeof WebhookSignatureSchema>;