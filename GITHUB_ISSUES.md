# UCP Agent - GitHub Issues

This document outlines the planned issues for completing the UCP Claude Agent implementation.

---

## Phase 1: Core SDK

### Issue #1: Complete UCP Schema Definitions
**Labels:** `sdk`, `priority-high`

Implement remaining UCP schemas from the official specification:
- [ ] Order management schemas (OrderSchema, OrderStatusSchema)
- [ ] Fulfillment schemas (ShipmentSchema, TrackingSchema)
- [ ] Identity linking schemas (OAuth2 flow types)
- [ ] Discount/promotion schemas
- [ ] Webhook event schemas

**Acceptance Criteria:**
- All schemas match UCP specification at ucp.dev
- Full TypeScript type inference
- Zod validation for all input/output

---

### Issue #2: Add Schema Validation Utilities
**Labels:** `sdk`, `dx`

Create helper functions for common validation patterns:
- [ ] `validateCheckoutRequest(data)` - returns typed result or errors
- [ ] `validateDiscoveryResponse(data)` - validate merchant discovery
- [ ] `isValidMoney(amount)` - currency/amount validation
- [ ] Error message formatting for user-friendly feedback

---

## Phase 2: Agent Enhancements

### Issue #3: Claude Tool Use Integration
**Labels:** `agent`, `priority-high`

Replace JSON action parsing with proper Claude tool use:
- [ ] Define tools using Anthropic's tool schema format
- [ ] Handle tool_use and tool_result messages
- [ ] Support parallel tool execution
- [ ] Add retry logic for failed tool calls

**References:**
- Anthropic tool use documentation
- Current implementation in `src/agent/claude-agent.ts`

---

### Issue #4: Multi-turn Conversation Memory
**Labels:** `agent`, `enhancement`

Improve conversation handling:
- [ ] Add conversation summarization for long sessions
- [ ] Persist checkout state across turns
- [ ] Handle context window limits gracefully
- [ ] Add session timeout/expiry handling

---

### Issue #5: Agent Error Handling & Recovery
**Labels:** `agent`, `reliability`

Robust error handling for the agent:
- [ ] Graceful degradation when merchant is unavailable
- [ ] Retry logic with exponential backoff
- [ ] User-friendly error messages
- [ ] Logging for debugging

---

## Phase 3: MCP Integration

### Issue #6: Complete MCP Tool Coverage
**Labels:** `mcp`, `priority-high`

Add missing MCP tools:
- [ ] `apply_discount` - Apply promo codes
- [ ] `get_shipping_options` - Fetch available shipping methods
- [ ] `select_shipping` - Choose a shipping option
- [ ] `complete_payment` - Finalize checkout with payment
- [ ] `cancel_checkout` - Abandon a session
- [ ] `get_order_status` - Track order post-purchase

---

### Issue #7: MCP Resource Handlers
**Labels:** `mcp`, `enhancement`

Implement MCP resources for state access:
- [ ] `checkout://current` - Current checkout session
- [ ] `merchant://capabilities` - Cached discovery response
- [ ] `cart://items` - Current cart contents
- [ ] Resource update notifications

---

### Issue #8: MCP Prompt Templates
**Labels:** `mcp`, `dx`

Add useful prompts for LLM clients:
- [ ] "Start shopping" - Initialize shopping flow
- [ ] "Complete checkout" - Guide through payment
- [ ] "Track order" - Post-purchase queries
- [ ] "Apply discount" - Coupon/promo workflow

---

## Phase 4: Server & API

### Issue #9: Implement Order Management Endpoints
**Labels:** `server`, `feature`

Add order management to the UCP server:
- [ ] POST `/ucp/orders` - Create order from checkout
- [ ] GET `/ucp/orders/:orderId` - Get order details
- [ ] PATCH `/ucp/orders/:orderId` - Update order status
- [ ] Webhook notifications for order updates

---

### Issue #10: Add Payment Handler Abstraction
**Labels:** `server`, `payments`, `priority-high`

Create payment integration layer:
- [ ] Payment handler interface definition
- [ ] Stripe handler implementation
- [ ] Mock/test payment handler
- [ ] Payment tokenization support
- [ ] AP2 (Agent Payments Protocol) integration stub

---

### Issue #11: Request Signing & Authentication
**Labels:** `server`, `security`

Implement UCP security requirements:
- [ ] UCP-Agent header validation
- [ ] Request signature verification
- [ ] Idempotency key handling
- [ ] Rate limiting

---

### Issue #12: Persistent Storage
**Labels:** `server`, `infrastructure`

Replace in-memory storage:
- [ ] SQLite integration for local dev
- [ ] Session persistence
- [ ] Order history
- [ ] Customer data (optional)

---

## Phase 5: A2A Protocol

### Issue #13: Agent-to-Agent Communication
**Labels:** `a2a`, `feature`

Implement A2A protocol support:
- [ ] A2A discovery mechanism
- [ ] Agent capability negotiation
- [ ] Structured message exchange
- [ ] Agent authentication

**References:**
- A2A Protocol specification
- Google's A2A implementation

---

### Issue #14: UCP as A2A Extension
**Labels:** `a2a`, `integration`

Expose UCP capabilities via A2A:
- [ ] Register UCP as A2A extension
- [ ] Map checkout capability to A2A actions
- [ ] Handle A2A-initiated checkouts
- [ ] Multi-agent commerce flows

---

## Phase 6: Testing & Documentation

### Issue #15: Unit Tests
**Labels:** `testing`, `priority-high`

Comprehensive test coverage:
- [ ] Schema validation tests
- [ ] Server endpoint tests
- [ ] Agent response tests
- [ ] MCP tool tests

---

### Issue #16: Integration Tests
**Labels:** `testing`

End-to-end test scenarios:
- [ ] Full checkout flow
- [ ] Multi-merchant discovery
- [ ] Error scenarios
- [ ] Payment simulation

---

### Issue #17: API Documentation
**Labels:** `docs`

Document the public API:
- [ ] OpenAPI spec for REST endpoints
- [ ] MCP tool documentation
- [ ] Agent configuration guide
- [ ] Example workflows

---

## Phase 7: Developer Experience

### Issue #18: CLI Tool
**Labels:** `dx`, `feature`

Add a CLI for common operations:
- [ ] `ucp discover <url>` - Discover merchant
- [ ] `ucp checkout create` - Start checkout
- [ ] `ucp agent start` - Run agent interactively
- [ ] `ucp serve` - Start local server

---

### Issue #19: Configuration System
**Labels:** `dx`, `enhancement`

Centralized configuration:
- [ ] Environment variable handling
- [ ] Config file support (.ucprc)
- [ ] Multiple merchant profiles
- [ ] Secure credential storage

---

### Issue #20: Example Merchant Implementation
**Labels:** `examples`, `docs`

Create a reference merchant:
- [ ] Product catalog with sample items
- [ ] Realistic pricing and inventory
- [ ] Multiple shipping options
- [ ] Discount code support

---

## Quick Reference

| Priority | Issue | Area |
|----------|-------|------|
| High | #1 | SDK - Complete schemas |
| High | #3 | Agent - Tool use |
| High | #6 | MCP - Complete tools |
| High | #10 | Server - Payments |
| High | #15 | Testing - Unit tests |
| Medium | #2 | SDK - Validation utils |
| Medium | #4 | Agent - Memory |
| Medium | #7 | MCP - Resources |
| Medium | #9 | Server - Orders |
| Low | #8 | MCP - Prompts |
| Low | #13-14 | A2A support |
| Low | #18-20 | DX & Examples |
