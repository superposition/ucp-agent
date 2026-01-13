import { z } from "zod";

// UCP Common Schemas - Based on Universal Commerce Protocol Specification

export const MoneySchema = z.object({
  amount: z.string().describe("Decimal amount as string for precision"),
  currency: z.string().length(3).describe("ISO 4217 currency code"),
});

export const AddressSchema = z.object({
  line1: z.string(),
  line2: z.string().optional(),
  city: z.string(),
  region: z.string().optional(),
  postalCode: z.string(),
  country: z.string().length(2).describe("ISO 3166-1 alpha-2 country code"),
});

export const ContactSchema = z.object({
  name: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export const LineItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  quantity: z.number().int().positive(),
  unitPrice: MoneySchema,
  totalPrice: MoneySchema,
  imageUrl: z.string().url().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
});

export const CartSchema = z.object({
  items: z.array(LineItemSchema),
  subtotal: MoneySchema,
  tax: MoneySchema.optional(),
  shipping: MoneySchema.optional(),
  discount: MoneySchema.optional(),
  total: MoneySchema,
});

export const CustomerSchema = z.object({
  id: z.string().optional(),
  contact: ContactSchema,
  shippingAddress: AddressSchema.optional(),
  billingAddress: AddressSchema.optional(),
});

// Type exports
export type Money = z.infer<typeof MoneySchema>;
export type Address = z.infer<typeof AddressSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type LineItem = z.infer<typeof LineItemSchema>;
export type Cart = z.infer<typeof CartSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
