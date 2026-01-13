import { z } from "zod";
import { MoneySchema } from "./common";

// Discount type
export const DiscountTypeSchema = z.enum([
  "PERCENTAGE",      // e.g., 20% off
  "FIXED_AMOUNT",    // e.g., $10 off
  "FREE_SHIPPING",   // Free shipping
  "BUY_X_GET_Y",     // Buy 2 get 1 free
  "FIXED_PRICE",     // Set price to specific amount
]);

// Discount scope - what the discount applies to
export const DiscountScopeSchema = z.enum([
  "ORDER",           // Applies to entire order
  "LINE_ITEM",       // Applies to specific items
  "SHIPPING",        // Applies to shipping cost
  "CATEGORY",        // Applies to product category
]);

// Conditions for discount eligibility
export const DiscountConditionSchema = z.object({
  type: z.enum([
    "MIN_PURCHASE",      // Minimum order amount
    "MIN_QUANTITY",      // Minimum item quantity
    "SPECIFIC_PRODUCTS", // Only certain products
    "SPECIFIC_CATEGORIES", // Only certain categories
    "FIRST_ORDER",       // New customers only
    "CUSTOMER_TAG",      // Customers with specific tag
  ]),
  value: z.union([
    z.string(),
    z.number(),
    z.array(z.string()),
  ]),
});

// Discount/Promotion schema
export const DiscountSchema = z.object({
  id: z.string(),
  code: z.string().optional().describe("Promo code if user-entered"),
  name: z.string(),
  description: z.string().optional(),

  // Type and value
  type: DiscountTypeSchema,
  value: z.number().describe("Percentage (0-100) or fixed amount"),
  currency: z.string().optional().describe("Required for FIXED_AMOUNT type"),

  // Scope
  scope: DiscountScopeSchema,
  applicableProductIds: z.array(z.string()).optional(),
  applicableCategoryIds: z.array(z.string()).optional(),

  // Conditions
  conditions: z.array(DiscountConditionSchema).optional(),
  minPurchaseAmount: MoneySchema.optional(),
  maxDiscountAmount: MoneySchema.optional().describe("Cap on discount value"),

  // Usage limits
  usageLimit: z.number().int().positive().optional(),
  usageCount: z.number().int().min(0).default(0),
  perCustomerLimit: z.number().int().positive().optional(),

  // Validity
  isActive: z.boolean().default(true),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),

  // Stacking rules
  stackable: z.boolean().default(false).describe("Can combine with other discounts"),
  priority: z.number().int().default(0).describe("Higher = applied first"),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Applied discount on a cart/order
export const AppliedDiscountSchema = z.object({
  discountId: z.string(),
  code: z.string().optional(),
  name: z.string(),
  type: DiscountTypeSchema,
  scope: DiscountScopeSchema,
  amount: MoneySchema.describe("Actual discount amount applied"),
  lineItemId: z.string().optional().describe("If applied to specific item"),
});

// Apply discount request
export const ApplyDiscountRequestSchema = z.object({
  sessionId: z.string().describe("Checkout session ID"),
  code: z.string().describe("Promo code to apply"),
});

// Apply discount response
export const ApplyDiscountResponseSchema = z.object({
  success: z.boolean(),
  discount: AppliedDiscountSchema.optional(),
  error: z.string().optional(),
  newTotal: MoneySchema.optional(),
});

// Remove discount request
export const RemoveDiscountRequestSchema = z.object({
  sessionId: z.string(),
  discountId: z.string(),
});

// Validate discount request (check without applying)
export const ValidateDiscountRequestSchema = z.object({
  code: z.string(),
  cartTotal: MoneySchema,
  productIds: z.array(z.string()).optional(),
  customerId: z.string().optional(),
});

export const ValidateDiscountResponseSchema = z.object({
  valid: z.boolean(),
  discount: DiscountSchema.optional(),
  estimatedSavings: MoneySchema.optional(),
  error: z.string().optional(),
});

// Type exports
export type DiscountType = z.infer<typeof DiscountTypeSchema>;
export type DiscountScope = z.infer<typeof DiscountScopeSchema>;
export type DiscountCondition = z.infer<typeof DiscountConditionSchema>;
export type Discount = z.infer<typeof DiscountSchema>;
export type AppliedDiscount = z.infer<typeof AppliedDiscountSchema>;
export type ApplyDiscountRequest = z.infer<typeof ApplyDiscountRequestSchema>;
export type ApplyDiscountResponse = z.infer<typeof ApplyDiscountResponseSchema>;
export type RemoveDiscountRequest = z.infer<typeof RemoveDiscountRequestSchema>;
export type ValidateDiscountRequest = z.infer<typeof ValidateDiscountRequestSchema>;
export type ValidateDiscountResponse = z.infer<typeof ValidateDiscountResponseSchema>;
