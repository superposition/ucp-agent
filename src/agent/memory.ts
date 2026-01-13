import type { MessageParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import type { CheckoutSession, UCPDiscoveryResponse } from "../sdk";

// ============================================
// CONFIGURATION
// ============================================

export interface MemoryConfig {
  /** Maximum number of messages to keep in history before summarizing */
  maxMessages?: number;
  /** Maximum total tokens to estimate in history (rough approximation) */
  maxTokens?: number;
  /** Session timeout in milliseconds (default: 30 minutes) */
  sessionTimeoutMs?: number;
  /** Enable automatic summarization when limits are reached */
  autoSummarize?: boolean;
  /** Persist session state to storage */
  persistState?: boolean;
}

const DEFAULT_CONFIG: Required<MemoryConfig> = {
  maxMessages: 50,
  maxTokens: 50000, // ~12.5k words, safe for 100k context
  sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
  autoSummarize: true,
  persistState: false,
};

// ============================================
// CONVERSATION STATE
// ============================================

export interface ConversationState {
  /** Unique session identifier */
  sessionId: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Conversation history */
  messages: MessageParam[];
  /** Summarized context from older messages */
  summary: string | null;
  /** Number of messages that were summarized */
  summarizedCount: number;
  /** Current checkout session */
  checkoutSession: CheckoutSession | null;
  /** Discovered merchant capabilities */
  merchantCapabilities: UCPDiscoveryResponse | null;
  /** Custom metadata */
  metadata: Record<string, unknown>;
}

export interface ConversationSummary {
  /** Key topics discussed */
  topics: string[];
  /** Important decisions made */
  decisions: string[];
  /** Current shopping context */
  shoppingContext: {
    itemsDiscussed: string[];
    preferencesExpressed: string[];
    questionsAsked: string[];
  };
  /** Checkout progress */
  checkoutProgress: {
    hasSession: boolean;
    sessionId: string | null;
    status: string | null;
    itemCount: number;
    totalAmount: string | null;
  };
}

// ============================================
// MEMORY MANAGER
// ============================================

export class ConversationMemory {
  private state: ConversationState;
  private config: Required<MemoryConfig>;

  constructor(config: MemoryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = this.createNewState();
  }

  private createNewState(): ConversationState {
    const now = Date.now();
    return {
      sessionId: crypto.randomUUID(),
      createdAt: now,
      lastActivityAt: now,
      messages: [],
      summary: null,
      summarizedCount: 0,
      checkoutSession: null,
      merchantCapabilities: null,
      metadata: {},
    };
  }

  // ============================================
  // MESSAGE MANAGEMENT
  // ============================================

  /**
   * Add a message to the conversation history
   */
  addMessage(message: MessageParam): void {
    this.state.messages.push(message);
    this.state.lastActivityAt = Date.now();

    // Check if we need to summarize
    if (this.config.autoSummarize && this.shouldSummarize()) {
      this.compactHistory();
    }
  }

  /**
   * Get all messages including summary context if available
   */
  getMessages(): MessageParam[] {
    return this.state.messages;
  }

  /**
   * Get messages with summary prepended as context
   */
  getMessagesWithContext(): MessageParam[] {
    if (!this.state.summary) {
      return this.state.messages;
    }

    // Prepend summary as a system-style context message
    const summaryContext: MessageParam = {
      role: "user",
      content: `[Previous conversation summary: ${this.state.summary}]`,
    };

    const acknowledgment: MessageParam = {
      role: "assistant",
      content: "I understand the context from our previous conversation. How can I help you continue?",
    };

    return [summaryContext, acknowledgment, ...this.state.messages];
  }

  /**
   * Clear all messages but keep session state
   */
  clearMessages(): void {
    this.state.messages = [];
    this.state.summary = null;
    this.state.summarizedCount = 0;
  }

  // ============================================
  // TOKEN ESTIMATION
  // ============================================

  /**
   * Estimate token count for messages (rough approximation: ~4 chars per token)
   */
  estimateTokens(messages?: MessageParam[]): number {
    const msgs = messages || this.state.messages;
    let totalChars = 0;

    for (const msg of msgs) {
      if (typeof msg.content === "string") {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ("text" in block && typeof block.text === "string") {
            totalChars += block.text.length;
          } else if ("content" in block && typeof block.content === "string") {
            totalChars += block.content.length;
          }
        }
      }
    }

    // Rough estimate: 4 characters per token
    return Math.ceil(totalChars / 4);
  }

  /**
   * Check if summarization is needed
   */
  shouldSummarize(): boolean {
    const messageCount = this.state.messages.length;
    const estimatedTokens = this.estimateTokens();

    return (
      messageCount > this.config.maxMessages ||
      estimatedTokens > this.config.maxTokens
    );
  }

  // ============================================
  // SUMMARIZATION
  // ============================================

  /**
   * Generate a summary of the conversation
   */
  generateSummary(): ConversationSummary {
    const summary: ConversationSummary = {
      topics: [],
      decisions: [],
      shoppingContext: {
        itemsDiscussed: [],
        preferencesExpressed: [],
        questionsAsked: [],
      },
      checkoutProgress: {
        hasSession: this.state.checkoutSession !== null,
        sessionId: this.state.checkoutSession?.id || null,
        status: this.state.checkoutSession?.status || null,
        itemCount: this.state.checkoutSession?.cart.items.length || 0,
        totalAmount: this.state.checkoutSession?.cart.total.amount || null,
      },
    };

    // Extract information from messages
    for (const msg of this.state.messages) {
      if (msg.role === "user" && typeof msg.content === "string") {
        // Track questions
        if (msg.content.includes("?")) {
          summary.shoppingContext.questionsAsked.push(
            msg.content.substring(0, 100)
          );
        }
      }
    }

    return summary;
  }

  /**
   * Create a text summary of the conversation
   */
  createTextSummary(): string {
    const summary = this.generateSummary();
    const parts: string[] = [];

    if (summary.checkoutProgress.hasSession) {
      parts.push(
        `Active checkout session (${summary.checkoutProgress.sessionId}) ` +
        `with ${summary.checkoutProgress.itemCount} items, ` +
        `total: $${summary.checkoutProgress.totalAmount}, ` +
        `status: ${summary.checkoutProgress.status}`
      );
    }

    if (summary.shoppingContext.questionsAsked.length > 0) {
      parts.push(
        `User asked about: ${summary.shoppingContext.questionsAsked.slice(0, 3).join("; ")}`
      );
    }

    if (this.state.merchantCapabilities) {
      parts.push(
        `Shopping with merchant: ${this.state.merchantCapabilities.merchantName}`
      );
    }

    return parts.length > 0 ? parts.join(". ") : "General shopping conversation.";
  }

  /**
   * Compact history by summarizing older messages
   */
  compactHistory(): void {
    if (this.state.messages.length <= 10) {
      return; // Keep at least recent messages
    }

    // Keep the last 10 messages, summarize the rest
    const keepCount = 10;
    const toSummarize = this.state.messages.slice(0, -keepCount);
    const toKeep = this.state.messages.slice(-keepCount);

    // Create summary from older messages
    const oldSummary = this.state.summary || "";
    const newSummaryPart = this.summarizeMessages(toSummarize);

    this.state.summary = oldSummary
      ? `${oldSummary} ${newSummaryPart}`
      : newSummaryPart;
    this.state.summarizedCount += toSummarize.length;
    this.state.messages = toKeep;
  }

  /**
   * Summarize a set of messages into text
   */
  private summarizeMessages(messages: MessageParam[]): string {
    const userMessages: string[] = [];
    const toolsUsed: string[] = [];

    for (const msg of messages) {
      if (msg.role === "user" && typeof msg.content === "string") {
        userMessages.push(msg.content.substring(0, 50));
      } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ("type" in block && block.type === "tool_use" && "name" in block) {
            toolsUsed.push(block.name as string);
          }
        }
      }
    }

    const parts: string[] = [];
    if (userMessages.length > 0) {
      parts.push(`User discussed: ${userMessages.slice(0, 3).join(", ")}`);
    }
    if (toolsUsed.length > 0) {
      const uniqueTools = [...new Set(toolsUsed)];
      parts.push(`Tools used: ${uniqueTools.join(", ")}`);
    }

    return parts.join(". ");
  }

  // ============================================
  // SESSION STATE
  // ============================================

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.state.sessionId;
  }

  /**
   * Check if session has expired
   */
  isExpired(): boolean {
    const elapsed = Date.now() - this.state.lastActivityAt;
    return elapsed > this.config.sessionTimeoutMs;
  }

  /**
   * Get time until session expires in milliseconds
   */
  getTimeUntilExpiry(): number {
    const elapsed = Date.now() - this.state.lastActivityAt;
    return Math.max(0, this.config.sessionTimeoutMs - elapsed);
  }

  /**
   * Touch the session to update last activity time
   */
  touch(): void {
    this.state.lastActivityAt = Date.now();
  }

  /**
   * Reset the session completely
   */
  reset(): void {
    this.state = this.createNewState();
  }

  // ============================================
  // CHECKOUT STATE
  // ============================================

  /**
   * Set the current checkout session
   */
  setCheckoutSession(session: CheckoutSession | null): void {
    this.state.checkoutSession = session;
    this.state.lastActivityAt = Date.now();
  }

  /**
   * Get the current checkout session
   */
  getCheckoutSession(): CheckoutSession | null {
    return this.state.checkoutSession;
  }

  /**
   * Set merchant capabilities
   */
  setMerchantCapabilities(capabilities: UCPDiscoveryResponse | null): void {
    this.state.merchantCapabilities = capabilities;
  }

  /**
   * Get merchant capabilities
   */
  getMerchantCapabilities(): UCPDiscoveryResponse | null {
    return this.state.merchantCapabilities;
  }

  // ============================================
  // METADATA
  // ============================================

  /**
   * Set metadata value
   */
  setMetadata(key: string, value: unknown): void {
    this.state.metadata[key] = value;
  }

  /**
   * Get metadata value
   */
  getMetadata<T = unknown>(key: string): T | undefined {
    return this.state.metadata[key] as T | undefined;
  }

  /**
   * Get all metadata
   */
  getAllMetadata(): Record<string, unknown> {
    return { ...this.state.metadata };
  }

  // ============================================
  // SERIALIZATION
  // ============================================

  /**
   * Export state for persistence
   */
  exportState(): ConversationState {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Import state from persistence
   */
  importState(state: ConversationState): void {
    this.state = state;
  }

  /**
   * Get statistics about the conversation
   */
  getStats(): {
    messageCount: number;
    summarizedCount: number;
    estimatedTokens: number;
    sessionAge: number;
    lastActivity: number;
    hasCheckout: boolean;
    isExpired: boolean;
  } {
    return {
      messageCount: this.state.messages.length,
      summarizedCount: this.state.summarizedCount,
      estimatedTokens: this.estimateTokens(),
      sessionAge: Date.now() - this.state.createdAt,
      lastActivity: Date.now() - this.state.lastActivityAt,
      hasCheckout: this.state.checkoutSession !== null,
      isExpired: this.isExpired(),
    };
  }
}

// ============================================
// SESSION STORE (Multi-session management)
// ============================================

export class SessionStore {
  private sessions = new Map<string, ConversationMemory>();
  private config: MemoryConfig;

  constructor(config: MemoryConfig = {}) {
    this.config = config;
  }

  /**
   * Get or create a session
   */
  getOrCreate(sessionId?: string): ConversationMemory {
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      if (!session.isExpired()) {
        session.touch();
        return session;
      }
      // Session expired, remove it
      this.sessions.delete(sessionId);
    }

    // Create new session
    const memory = new ConversationMemory(this.config);
    this.sessions.set(memory.getSessionId(), memory);
    return memory;
  }

  /**
   * Get an existing session
   */
  get(sessionId: string): ConversationMemory | undefined {
    const session = this.sessions.get(sessionId);
    if (session && !session.isExpired()) {
      return session;
    }
    if (session) {
      this.sessions.delete(sessionId);
    }
    return undefined;
  }

  /**
   * Remove a session
   */
  remove(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpired(): number {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.isExpired()) {
        this.sessions.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    const active: string[] = [];
    for (const [id, session] of this.sessions) {
      if (!session.isExpired()) {
        active.push(id);
      }
    }
    return active;
  }

  /**
   * Get count of active sessions
   */
  getActiveCount(): number {
    return this.getActiveSessions().length;
  }
}
