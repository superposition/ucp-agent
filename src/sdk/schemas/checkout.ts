import { z } from "zod";
import { CartSchema, CustomerSchema, MoneySchema, AddressSchema } from "./common";

// UCP Checkout Capability Schemas

export const CheckoutSessionStatusSchema = z.enum([
  "PENDING",
  "READY",
  "PROCESSING",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
]);

export const PaymentMethodSchema = z.object({
  type: z.string(),
  provider: z.string().optional(),
  token: z.string().optional(),
  lastFour: z.string().optional(),
});

export const ShippingOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  price: MoneySchema,
  estimatedDelivery: z.string().optional(),
  carrier: z.string().optional(),
});

export const CreateCheckoutRequestSchema = z.object({
  merchantId: z.string(),
  cart: CartSchema,
  customer: CustomerSchema.optional(),
  redirectUrls: z
    .object({
      success: z.string().url(),
      cancel: z.string().url(),
      webhook: z.string().url().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const CheckoutSessionSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  status: CheckoutSessionStatusSchema,
  cart: CartSchema,
  customer: CustomerSchema.optional(),
  shippingAddress: AddressSchema.optional(),
  billingAddress: AddressSchema.optional(),
  selectedShippingOption: ShippingOptionSchema.optional(),
  availableShippingOptions: z.array(ShippingOptionSchema).optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const UpdateCheckoutRequestSchema = z.object({
  sessionId: z.string(),
  customer: CustomerSchema.optional(),
  shippingAddress: AddressSchema.optional(),
  billingAddress: AddressSchema.optional(),
  shippingOptionId: z.string().optional(),
  discountCode: z.string().optional(),
});

export const CompleteCheckoutRequestSchema = z.object({
  sessionId: z.string(),
  paymentMethod: PaymentMethodSchema,
  confirmationToken: z.string().optional(),
});

export const CheckoutResultSchema = z.object({
  sessionId: z.string(),
  orderId: z.string(),
  status: z.enum(["SUCCESS", "FAILED", "PENDING_CONFIRMATION"]),
  confirmationUrl: z.string().url().optional(),
  errorMessage: z.string().optional(),
});

// Type exports
export type CheckoutSessionStatus = z.infer<typeof CheckoutSessionStatusSchema>;
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type ShippingOption = z.infer<typeof ShippingOptionSchema>;
export type CreateCheckoutRequest = z.infer<typeof CreateCheckoutRequestSchema>;
export type CheckoutSession = z.infer<typeof CheckoutSessionSchema>;
export type UpdateCheckoutRequest = z.infer<typeof UpdateCheckoutRequestSchema>;
export type CompleteCheckoutRequest = z.infer<typeof CompleteCheckoutRequestSchema>;
export type CheckoutResult = z.infer<typeof CheckoutResultSchema>;
