import { z } from "zod";

// OAuth2 Grant Types supported
export const OAuth2GrantTypeSchema = z.enum([
  "authorization_code",
  "refresh_token",
  "client_credentials",
]);

// OAuth2 Token Response
export const OAuth2TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().default("Bearer"),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

// OAuth2 Error Response
export const OAuth2ErrorResponseSchema = z.object({
  error: z.enum([
    "invalid_request",
    "invalid_client",
    "invalid_grant",
    "unauthorized_client",
    "unsupported_grant_type",
    "invalid_scope",
    "access_denied",
    "server_error",
  ]),
  error_description: z.string().optional(),
  error_uri: z.string().url().optional(),
});

// Authorization request (start of OAuth flow)
export const AuthorizationRequestSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string(),
  redirect_uri: z.string().url(),
  scope: z.string().optional(),
  state: z.string().describe("CSRF protection token"),
  code_challenge: z.string().optional().describe("PKCE code challenge"),
  code_challenge_method: z.enum(["plain", "S256"]).optional(),
});

// Authorization response (after user consent)
export const AuthorizationResponseSchema = z.object({
  code: z.string(),
  state: z.string(),
});

// Token request (exchange code for tokens)
export const TokenRequestSchema = z.object({
  grant_type: OAuth2GrantTypeSchema,
  code: z.string().optional().describe("Required for authorization_code grant"),
  redirect_uri: z.string().url().optional(),
  client_id: z.string(),
  client_secret: z.string().optional(),
  refresh_token: z.string().optional().describe("Required for refresh_token grant"),
  code_verifier: z.string().optional().describe("PKCE code verifier"),
});

// Linked identity/account
export const LinkedIdentitySchema = z.object({
  id: z.string(),
  provider: z.string().describe("e.g., 'google', 'merchant-name'"),
  providerId: z.string().describe("User ID at the provider"),
  email: z.string().email().optional(),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),

  // Tokens (typically not exposed to client)
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  tokenExpiresAt: z.string().datetime().optional(),

  // Scopes granted
  scopes: z.array(z.string()).optional(),

  // Timestamps
  linkedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().optional(),
});

// Identity link request (initiate account linking)
export const IdentityLinkRequestSchema = z.object({
  provider: z.string(),
  redirectUri: z.string().url(),
  scopes: z.array(z.string()).optional(),
  state: z.string().optional().describe("Custom state to pass through"),
});

// Identity link response (URL to redirect user)
export const IdentityLinkResponseSchema = z.object({
  authorizationUrl: z.string().url(),
  state: z.string(),
  expiresAt: z.string().datetime(),
});

// Identity link callback (after OAuth redirect)
export const IdentityLinkCallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
});

// Unlink identity request
export const UnlinkIdentityRequestSchema = z.object({
  identityId: z.string(),
});

// User profile from linked identity
export const LinkedUserProfileSchema = z.object({
  identityId: z.string(),
  provider: z.string(),
  email: z.string().email().optional(),
  emailVerified: z.boolean().optional(),
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  locale: z.string().optional(),

  // Provider-specific data
  providerData: z.record(z.string(), z.unknown()).optional(),
});

// UCP Identity Linking capability config
export const IdentityLinkingConfigSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      authorizationEndpoint: z.string().url(),
      tokenEndpoint: z.string().url(),
      userInfoEndpoint: z.string().url().optional(),
      scopes: z.array(z.string()),
      pkceRequired: z.boolean().default(false),
    })
  ),
});

// Type exports
export type OAuth2GrantType = z.infer<typeof OAuth2GrantTypeSchema>;
export type OAuth2TokenResponse = z.infer<typeof OAuth2TokenResponseSchema>;
export type OAuth2ErrorResponse = z.infer<typeof OAuth2ErrorResponseSchema>;
export type AuthorizationRequest = z.infer<typeof AuthorizationRequestSchema>;
export type AuthorizationResponse = z.infer<typeof AuthorizationResponseSchema>;
export type TokenRequest = z.infer<typeof TokenRequestSchema>;
export type LinkedIdentity = z.infer<typeof LinkedIdentitySchema>;
export type IdentityLinkRequest = z.infer<typeof IdentityLinkRequestSchema>;
export type IdentityLinkResponse = z.infer<typeof IdentityLinkResponseSchema>;
export type IdentityLinkCallback = z.infer<typeof IdentityLinkCallbackSchema>;
export type UnlinkIdentityRequest = z.infer<typeof UnlinkIdentityRequestSchema>;
export type LinkedUserProfile = z.infer<typeof LinkedUserProfileSchema>;
export type IdentityLinkingConfig = z.infer<typeof IdentityLinkingConfigSchema>;
