import { z } from "zod";

// UCP Discovery Schemas - /.well-known/ucp endpoint

export const CapabilitySchema = z.object({
  id: z.string().describe("Capability identifier, e.g., dev.ucp.shopping.checkout"),
  version: z.string().describe("Semantic version of the capability"),
  extensions: z.array(z.string()).optional().describe("Supported extensions"),
});

export const ServiceBindingSchema = z.object({
  type: z.enum(["REST", "MCP", "A2A", "EMBEDDED"]),
  endpoint: z.string().url(),
  version: z.string().optional(),
  authentication: z
    .object({
      type: z.enum(["NONE", "API_KEY", "OAUTH2", "JWT"]),
      tokenEndpoint: z.string().url().optional(),
      scopes: z.array(z.string()).optional(),
    })
    .optional(),
});

export const PaymentHandlerSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().describe("e.g., GOOGLE_PAY, STRIPE, SHOPIFY_PAY"),
  supportedMethods: z.array(z.string()),
  configuration: z.record(z.string(), z.unknown()).optional(),
});

export const UCPDiscoveryResponseSchema = z.object({
  version: z.string().describe("UCP specification version"),
  merchantId: z.string(),
  merchantName: z.string(),
  services: z.array(
    z.object({
      name: z.string().describe("Service name, e.g., Shopping"),
      capabilities: z.array(CapabilitySchema),
      bindings: z.array(ServiceBindingSchema),
    })
  ),
  paymentHandlers: z.array(PaymentHandlerSchema).optional(),
  supportedCurrencies: z.array(z.string()).optional(),
  supportedCountries: z.array(z.string()).optional(),
  termsOfServiceUrl: z.string().url().optional(),
  privacyPolicyUrl: z.string().url().optional(),
  contactEmail: z.string().email().optional(),
});

// Type exports
export type Capability = z.infer<typeof CapabilitySchema>;
export type ServiceBinding = z.infer<typeof ServiceBindingSchema>;
export type PaymentHandler = z.infer<typeof PaymentHandlerSchema>;
export type UCPDiscoveryResponse = z.infer<typeof UCPDiscoveryResponseSchema>;
