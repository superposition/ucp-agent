import { z } from "zod";
import { MoneySchema, AddressSchema, ContactSchema, CartSchema } from "./common";
import { PaymentMethodSchema } from "./checkout";

// Order Status
export const OrderStatusSchema = z.enum([
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "FAILED",
]);

// Order Line Item (slightly different from cart - includes fulfillment status)
export const OrderLineItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  sku: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  quantity: z.number().int().positive(),
  quantityFulfilled: z.number().int().min(0).default(0),
  quantityCancelled: z.number().int().min(0).default(0),
  unitPrice: MoneySchema,
  totalPrice: MoneySchema,
  imageUrl: z.string().url().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
});

// Payment record for an order
export const OrderPaymentSchema = z.object({
  id: z.string(),
  method: PaymentMethodSchema,
  amount: MoneySchema,
  status: z.enum(["PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED"]),
  transactionId: z.string().optional(),
  capturedAt: z.string().datetime().optional(),
  refundedAt: z.string().datetime().optional(),
});

// Order totals breakdown
export const OrderTotalsSchema = z.object({
  subtotal: MoneySchema,
  tax: MoneySchema.optional(),
  shipping: MoneySchema.optional(),
  discount: MoneySchema.optional(),
  total: MoneySchema,
  amountPaid: MoneySchema.optional(),
  amountRefunded: MoneySchema.optional(),
  amountDue: MoneySchema.optional(),
});

// Full Order schema
export const OrderSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  checkoutSessionId: z.string().optional(),
  orderNumber: z.string().optional().describe("Human-readable order number"),
  status: OrderStatusSchema,

  // Customer info
  customer: z.object({
    id: z.string().optional(),
    contact: ContactSchema,
  }),

  // Addresses
  shippingAddress: AddressSchema.optional(),
  billingAddress: AddressSchema.optional(),

  // Items
  lineItems: z.array(OrderLineItemSchema),

  // Financials
  totals: OrderTotalsSchema,
  payments: z.array(OrderPaymentSchema).optional(),

  // Metadata
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.string()).optional(),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().optional(),
  cancelledAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});

// Create order request (from a completed checkout)
export const CreateOrderRequestSchema = z.object({
  checkoutSessionId: z.string(),
  notes: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

// Update order request
export const UpdateOrderRequestSchema = z.object({
  orderId: z.string(),
  status: OrderStatusSchema.optional(),
  shippingAddress: AddressSchema.optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

// Cancel order request
export const CancelOrderRequestSchema = z.object({
  orderId: z.string(),
  reason: z.string().optional(),
  refundAmount: MoneySchema.optional().describe("Partial refund amount, if not full refund"),
});

// Order query/filter
export const OrderQuerySchema = z.object({
  customerId: z.string().optional(),
  status: z.array(OrderStatusSchema).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

// Type exports
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type OrderLineItem = z.infer<typeof OrderLineItemSchema>;
export type OrderPayment = z.infer<typeof OrderPaymentSchema>;
export type OrderTotals = z.infer<typeof OrderTotalsSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
export type UpdateOrderRequest = z.infer<typeof UpdateOrderRequestSchema>;
export type CancelOrderRequest = z.infer<typeof CancelOrderRequestSchema>;
export type OrderQuery = z.infer<typeof OrderQuerySchema>;
