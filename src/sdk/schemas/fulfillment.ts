import { z } from "zod";
import { AddressSchema } from "./common";

// Tracking event
export const TrackingEventSchema = z.object({
  timestamp: z.string().datetime(),
  status: z.string(),
  description: z.string(),
  location: z.string().optional(),
});

// Tracking info
export const TrackingSchema = z.object({
  carrier: z.string().describe("Carrier name (e.g., UPS, FedEx, USPS)"),
  carrierCode: z.string().optional().describe("Carrier identifier code"),
  trackingNumber: z.string(),
  trackingUrl: z.string().url().optional(),
  estimatedDelivery: z.string().datetime().optional(),
  events: z.array(TrackingEventSchema).optional(),
});

// Shipment status
export const ShipmentStatusSchema = z.enum([
  "PENDING",
  "LABEL_CREATED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED_ATTEMPT",
  "RETURNED",
  "CANCELLED",
]);

// Fulfilled item in a shipment
export const FulfilledItemSchema = z.object({
  lineItemId: z.string(),
  quantity: z.number().int().positive(),
});

// Package dimensions
export const PackageDimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.enum(["in", "cm"]).default("in"),
});

// Package weight
export const PackageWeightSchema = z.object({
  value: z.number().positive(),
  unit: z.enum(["lb", "oz", "kg", "g"]).default("lb"),
});

// Shipment schema
export const ShipmentSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  status: ShipmentStatusSchema,

  // What's in this shipment
  items: z.array(FulfilledItemSchema),

  // Shipping details
  shippingMethod: z.string().optional(),
  shippingAddress: AddressSchema,
  returnAddress: AddressSchema.optional(),

  // Package info
  dimensions: PackageDimensionsSchema.optional(),
  weight: PackageWeightSchema.optional(),

  // Tracking
  tracking: TrackingSchema.optional(),

  // Timestamps
  createdAt: z.string().datetime(),
  shippedAt: z.string().datetime().optional(),
  deliveredAt: z.string().datetime().optional(),

  // Notes
  notes: z.string().optional(),
});

// Create shipment request
export const CreateShipmentRequestSchema = z.object({
  orderId: z.string(),
  items: z.array(FulfilledItemSchema),
  shippingMethod: z.string().optional(),
  tracking: TrackingSchema.optional(),
  dimensions: PackageDimensionsSchema.optional(),
  weight: PackageWeightSchema.optional(),
  notes: z.string().optional(),
});

// Update shipment request
export const UpdateShipmentRequestSchema = z.object({
  shipmentId: z.string(),
  status: ShipmentStatusSchema.optional(),
  tracking: TrackingSchema.optional(),
  notes: z.string().optional(),
});

// Return/refund request
export const ReturnStatusSchema = z.enum([
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "SHIPPED",
  "RECEIVED",
  "REFUNDED",
  "CLOSED",
]);

export const ReturnReasonSchema = z.enum([
  "DEFECTIVE",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "CHANGED_MIND",
  "BETTER_PRICE_FOUND",
  "ARRIVED_LATE",
  "OTHER",
]);

export const ReturnRequestSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  status: ReturnStatusSchema,
  reason: ReturnReasonSchema,
  reasonDetails: z.string().optional(),

  // Items being returned
  items: z.array(FulfilledItemSchema),

  // Return shipping
  returnShipment: ShipmentSchema.optional(),

  // Refund info
  refundRequested: z.boolean().default(true),
  refundAmount: z
    .object({
      amount: z.string(),
      currency: z.string(),
    })
    .optional(),

  // Timestamps
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  receivedAt: z.string().datetime().optional(),
  refundedAt: z.string().datetime().optional(),
});

export const CreateReturnRequestSchema = z.object({
  orderId: z.string(),
  items: z.array(FulfilledItemSchema),
  reason: ReturnReasonSchema,
  reasonDetails: z.string().optional(),
});

// Type exports
export type TrackingEvent = z.infer<typeof TrackingEventSchema>;
export type Tracking = z.infer<typeof TrackingSchema>;
export type ShipmentStatus = z.infer<typeof ShipmentStatusSchema>;
export type FulfilledItem = z.infer<typeof FulfilledItemSchema>;
export type PackageDimensions = z.infer<typeof PackageDimensionsSchema>;
export type PackageWeight = z.infer<typeof PackageWeightSchema>;
export type Shipment = z.infer<typeof ShipmentSchema>;
export type CreateShipmentRequest = z.infer<typeof CreateShipmentRequestSchema>;
export type UpdateShipmentRequest = z.infer<typeof UpdateShipmentRequestSchema>;
export type ReturnStatus = z.infer<typeof ReturnStatusSchema>;
export type ReturnReason = z.infer<typeof ReturnReasonSchema>;
export type ReturnRequest = z.infer<typeof ReturnRequestSchema>;
export type CreateReturnRequest = z.infer<typeof CreateReturnRequestSchema>;
