import { describe, expect, test, beforeEach } from "bun:test";
import {
  ConversationMemory,
  SessionStore,
  type ConversationState,
} from "../src/agent/memory";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

describe("ConversationMemory", () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory();
  });

  describe("Message Management", () => {
    test("adds messages to history", () => {
      memory.addMessage({ role: "user", content: "Hello" });
      memory.addMessage({ role: "assistant", content: "Hi there!" });

      const messages = memory.getMessages();
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
    });

    test("clears messages but keeps session", () => {
      memory.addMessage({ role: "user", content: "Hello" });
      const sessionId = memory.getSessionId();

      memory.clearMessages();

      expect(memory.getMessages().length).toBe(0);
      expect(memory.getSessionId()).toBe(sessionId);
    });

    test("getMessagesWithContext returns messages when no summary", () => {
      memory.addMessage({ role: "user", content: "Test" });
      const messages = memory.getMessagesWithContext();
      expect(messages.length).toBe(1);
    });
  });

  describe("Token Estimation", () => {
    test("estimates tokens for string messages", () => {
      // 100 chars ≈ 25 tokens
      memory.addMessage({ role: "user", content: "a".repeat(100) });
      const tokens = memory.estimateTokens();
      expect(tokens).toBe(25);
    });

    test("estimates tokens for array content", () => {
      memory.addMessage({
        role: "assistant",
        content: [{ type: "text", text: "a".repeat(200) }],
      });
      const tokens = memory.estimateTokens();
      expect(tokens).toBe(50);
    });

    test("shouldSummarize returns false for small conversations", () => {
      memory.addMessage({ role: "user", content: "Hello" });
      expect(memory.shouldSummarize()).toBe(false);
    });
  });

  describe("Summarization", () => {
    test("generateSummary includes checkout info", () => {
      memory.setCheckoutSession({
        id: "session-123",
        merchantId: "merch-1",
        status: "PENDING",
        cart: {
          items: [
            {
              id: "item-1",
              productId: "prod-1",
              name: "Test",
              quantity: 1,
              unitPrice: { amount: "10.00", currency: "USD" },
              totalPrice: { amount: "10.00", currency: "USD" },
            },
          ],
          subtotal: { amount: "10.00", currency: "USD" },
          total: { amount: "10.00", currency: "USD" },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const summary = memory.generateSummary();
      expect(summary.checkoutProgress.hasSession).toBe(true);
      expect(summary.checkoutProgress.sessionId).toBe("session-123");
      expect(summary.checkoutProgress.itemCount).toBe(1);
    });

    test("createTextSummary includes merchant info", () => {
      memory.setMerchantCapabilities({
        version: "1.0.0",
        merchantId: "merch-1",
        merchantName: "Test Store",
        services: [],
      });

      const summary = memory.createTextSummary();
      expect(summary).toContain("Test Store");
    });

    test("compactHistory keeps recent messages", () => {
      // Add more than 10 messages
      for (let i = 0; i < 15; i++) {
        memory.addMessage({ role: "user", content: `Message ${i}` });
        memory.addMessage({ role: "assistant", content: `Response ${i}` });
      }

      memory.compactHistory();

      // Should keep last 10 messages
      expect(memory.getMessages().length).toBe(10);
    });
  });

  describe("Session State", () => {
    test("generates unique session ID", () => {
      const memory2 = new ConversationMemory();
      expect(memory.getSessionId()).not.toBe(memory2.getSessionId());
    });

    test("isExpired returns false for new session", () => {
      expect(memory.isExpired()).toBe(false);
    });

    test("isExpired returns true after timeout", () => {
      const shortTimeout = new ConversationMemory({
        sessionTimeoutMs: 1, // 1ms timeout
      });

      // Wait a bit
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      expect(shortTimeout.isExpired()).toBe(true);
    });

    test("touch updates last activity", () => {
      const memory = new ConversationMemory({
        sessionTimeoutMs: 100,
      });

      // Wait a bit
      const start = Date.now();
      while (Date.now() - start < 50) {
        // Busy wait
      }

      memory.touch();
      expect(memory.isExpired()).toBe(false);
    });

    test("getTimeUntilExpiry returns positive value", () => {
      const time = memory.getTimeUntilExpiry();
      expect(time).toBeGreaterThan(0);
    });

    test("reset creates new session", () => {
      const oldSessionId = memory.getSessionId();
      memory.addMessage({ role: "user", content: "Test" });

      memory.reset();

      expect(memory.getSessionId()).not.toBe(oldSessionId);
      expect(memory.getMessages().length).toBe(0);
    });
  });

  describe("Checkout State", () => {
    test("sets and gets checkout session", () => {
      const session = {
        id: "checkout-1",
        merchantId: "merch-1",
        status: "PENDING" as const,
        cart: {
          items: [],
          subtotal: { amount: "0", currency: "USD" },
          total: { amount: "0", currency: "USD" },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      memory.setCheckoutSession(session);
      expect(memory.getCheckoutSession()).toEqual(session);
    });

    test("sets and gets merchant capabilities", () => {
      const caps = {
        version: "1.0.0",
        merchantId: "test-merchant",
        merchantName: "Test",
        services: [],
      };

      memory.setMerchantCapabilities(caps);
      expect(memory.getMerchantCapabilities()).toEqual(caps);
    });
  });

  describe("Metadata", () => {
    test("sets and gets metadata", () => {
      memory.setMetadata("customerId", "cust-123");
      memory.setMetadata("preferences", { theme: "dark" });

      expect(memory.getMetadata("customerId")).toBe("cust-123");
      expect(memory.getMetadata<{ theme: string }>("preferences")?.theme).toBe("dark");
    });

    test("getAllMetadata returns copy", () => {
      memory.setMetadata("key", "value");
      const all = memory.getAllMetadata();

      all["key"] = "modified";
      expect(memory.getMetadata("key")).toBe("value");
    });
  });

  describe("Serialization", () => {
    test("exportState returns deep copy", () => {
      memory.addMessage({ role: "user", content: "Test" });
      memory.setMetadata("key", "value");

      const exported = memory.exportState();

      // Modify original
      memory.addMessage({ role: "assistant", content: "Response" });

      expect(exported.messages.length).toBe(1);
    });

    test("importState restores state", () => {
      const state: ConversationState = {
        sessionId: "imported-session",
        createdAt: Date.now() - 1000,
        lastActivityAt: Date.now(),
        messages: [{ role: "user", content: "Imported message" }],
        summary: "Previous context",
        summarizedCount: 5,
        checkoutSession: null,
        merchantCapabilities: null,
        metadata: { imported: true },
      };

      memory.importState(state);

      expect(memory.getSessionId()).toBe("imported-session");
      expect(memory.getMessages().length).toBe(1);
      expect(memory.getMetadata("imported")).toBe(true);
    });
  });

  describe("Statistics", () => {
    test("getStats returns accurate counts", () => {
      memory.addMessage({ role: "user", content: "Hello" });
      memory.addMessage({ role: "assistant", content: "Hi" });

      const stats = memory.getStats();

      expect(stats.messageCount).toBe(2);
      expect(stats.summarizedCount).toBe(0);
      expect(stats.estimatedTokens).toBeGreaterThan(0);
      expect(stats.hasCheckout).toBe(false);
      expect(stats.isExpired).toBe(false);
    });
  });
});

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
  });

  describe("Session Management", () => {
    test("getOrCreate creates new session", () => {
      const session = store.getOrCreate();
      expect(session).toBeDefined();
      expect(session.getSessionId()).toBeDefined();
    });

    test("getOrCreate returns existing session", () => {
      const session1 = store.getOrCreate();
      const sessionId = session1.getSessionId();

      const session2 = store.getOrCreate(sessionId);
      expect(session2.getSessionId()).toBe(sessionId);
    });

    test("get returns undefined for non-existent session", () => {
      expect(store.get("non-existent")).toBeUndefined();
    });

    test("remove deletes session", () => {
      const session = store.getOrCreate();
      const sessionId = session.getSessionId();

      expect(store.remove(sessionId)).toBe(true);
      expect(store.get(sessionId)).toBeUndefined();
    });
  });

  describe("Expiry Management", () => {
    test("getOrCreate creates new session for expired", () => {
      const shortTimeoutStore = new SessionStore({
        sessionTimeoutMs: 1,
      });

      const session1 = shortTimeoutStore.getOrCreate();
      const sessionId1 = session1.getSessionId();

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      const session2 = shortTimeoutStore.getOrCreate(sessionId1);
      expect(session2.getSessionId()).not.toBe(sessionId1);
    });

    test("cleanupExpired removes expired sessions", () => {
      const shortTimeoutStore = new SessionStore({
        sessionTimeoutMs: 1,
      });

      shortTimeoutStore.getOrCreate();
      shortTimeoutStore.getOrCreate();

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      const removed = shortTimeoutStore.cleanupExpired();
      expect(removed).toBe(2);
    });

    test("getActiveSessions excludes expired", () => {
      const shortTimeoutStore = new SessionStore({
        sessionTimeoutMs: 1,
      });

      shortTimeoutStore.getOrCreate();

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      expect(shortTimeoutStore.getActiveSessions().length).toBe(0);
    });
  });

  describe("Active Session Tracking", () => {
    test("getActiveCount returns correct count", () => {
      store.getOrCreate();
      store.getOrCreate();
      store.getOrCreate();

      expect(store.getActiveCount()).toBe(3);
    });

    test("getActiveSessions returns session IDs", () => {
      const s1 = store.getOrCreate();
      const s2 = store.getOrCreate();

      const active = store.getActiveSessions();
      expect(active).toContain(s1.getSessionId());
      expect(active).toContain(s2.getSessionId());
    });
  });
});
