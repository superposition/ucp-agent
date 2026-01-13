/**
 * Prompt Sanitizer - Protects against prompt injection attacks
 *
 * Filters malicious inputs that attempt to:
 * - Reveal system prompts
 * - Jailbreak the agent
 * - Extract sensitive configuration
 * - Manipulate agent behavior
 */

export interface SanitizationResult {
  safe: boolean;
  sanitized: string;
  violations: string[];
  riskScore: number; // 0-100, higher = more risky
}

export interface SanitizerConfig {
  maxLength?: number;
  blockPatterns?: RegExp[];
  warnPatterns?: RegExp[];
  allowedTopics?: string[];
  strictMode?: boolean; // If true, reject on any warning
}

// Common prompt injection patterns
const INJECTION_PATTERNS: { pattern: RegExp; severity: 'block' | 'warn'; name: string }[] = [
  // System prompt extraction attempts
  { pattern: /ignore\s+(all\s+)?(previous|prior|above)?\s*(instructions?|prompts?|rules?)/i, severity: 'block', name: 'ignore_instructions' },
  { pattern: /what\s+(is|are)\s+(your|the)\s+(system\s+)?(prompt|instructions?|rules?)/i, severity: 'block', name: 'prompt_extraction' },
  { pattern: /reveal\s+(your|the)\s+(system\s+)?(prompt|instructions?|configuration)/i, severity: 'block', name: 'reveal_prompt' },
  { pattern: /show\s+(me\s+)?(your|the)\s+(\w+\s+)*(prompt|instructions?)/i, severity: 'block', name: 'show_prompt' },
  { pattern: /print\s+(your|the)\s+(system\s+)?(prompt|instructions?)/i, severity: 'block', name: 'print_prompt' },
  { pattern: /output\s+(your|the)\s+(system\s+)?(prompt|instructions?|configuration)/i, severity: 'block', name: 'output_prompt' },
  { pattern: /repeat\s+(your|the)\s+(system\s+)?(prompt|instructions?)\s*(back|verbatim)?/i, severity: 'block', name: 'repeat_prompt' },

  // Role manipulation
  { pattern: /you\s+are\s+(now|no\s+longer)\s+a/i, severity: 'block', name: 'role_override' },
  { pattern: /pretend\s+(to\s+be|you('re| are))\s+(a\s+)?/i, severity: 'warn', name: 'pretend_role' },
  { pattern: /act\s+as\s+(if\s+you('re| are)|a)\s+/i, severity: 'warn', name: 'act_as' },
  { pattern: /roleplay\s+as/i, severity: 'warn', name: 'roleplay' },
  { pattern: /switch\s+(to|into)\s+(\w+)\s+mode/i, severity: 'block', name: 'mode_switch' },
  { pattern: /enter\s+(\w+)\s+mode/i, severity: 'block', name: 'enter_mode' },
  { pattern: /enable\s+(developer|admin|debug|god)\s+mode/i, severity: 'block', name: 'enable_mode' },

  // Jailbreak attempts
  { pattern: /DAN|Do\s+Anything\s+Now/i, severity: 'block', name: 'dan_jailbreak' },
  { pattern: /jailbreak/i, severity: 'block', name: 'jailbreak_keyword' },
  { pattern: /bypass\s+(your\s+)?(restrictions?|filters?|rules?|guidelines?)/i, severity: 'block', name: 'bypass_restrictions' },
  { pattern: /without\s+(any\s+)?(restrictions?|limitations?|filters?)/i, severity: 'warn', name: 'without_restrictions' },
  { pattern: /disable\s+(your\s+)?(safety|content)\s+(filters?|guidelines?)/i, severity: 'block', name: 'disable_safety' },

  // Credential/secret extraction
  { pattern: /what\s+(is|are)\s+(your|the)\s+(api|secret)\s*key/i, severity: 'block', name: 'api_key_extraction' },
  { pattern: /(show|tell|give)\s+(me\s+)?(your|the)\s+(api|secret|private)\s*key/i, severity: 'block', name: 'key_extraction' },
  { pattern: /environment\s+variables?/i, severity: 'warn', name: 'env_vars' },
  { pattern: /\.env\s+file/i, severity: 'block', name: 'env_file' },
  { pattern: /(password|credential|secret|token)s?\s*(is|are|=)/i, severity: 'warn', name: 'credential_query' },

  // Code execution attempts
  { pattern: /exec(ute)?\s*\(/i, severity: 'warn', name: 'exec_attempt' },
  { pattern: /eval\s*\(/i, severity: 'warn', name: 'eval_attempt' },
  { pattern: /import\s+os|subprocess|sys\./i, severity: 'block', name: 'dangerous_import' },
  { pattern: /\$\{.*\}/i, severity: 'warn', name: 'template_injection' },
  { pattern: /`.*`/i, severity: 'warn', name: 'backtick_execution' },

  // Data exfiltration
  { pattern: /send\s+(this|data|information)\s+to/i, severity: 'warn', name: 'data_exfil' },
  { pattern: /POST\s+to\s+https?:\/\//i, severity: 'block', name: 'post_external' },
  { pattern: /webhook\s*(url|endpoint)/i, severity: 'warn', name: 'webhook_mention' },

  // Delimiter manipulation
  { pattern: /```\s*(system|admin|root)/i, severity: 'block', name: 'delimiter_manipulation' },
  { pattern: /<\/?system>/i, severity: 'block', name: 'system_tag' },
  { pattern: /\[SYSTEM\]/i, severity: 'block', name: 'system_bracket' },
  { pattern: /###\s*(system|instruction|admin)/i, severity: 'block', name: 'header_injection' },
];

// Topics that should stay within UCP commerce domain
const COMMERCE_KEYWORDS = [
  'buy', 'purchase', 'checkout', 'cart', 'order', 'product', 'item',
  'price', 'shipping', 'payment', 'merchant', 'shop', 'store',
  'discount', 'coupon', 'promo', 'delivery', 'address', 'billing'
];

export class PromptSanitizer {
  private config: Required<SanitizerConfig>;
  private customBlockPatterns: RegExp[] = [];
  private customWarnPatterns: RegExp[] = [];

  constructor(config: SanitizerConfig = {}) {
    this.config = {
      maxLength: config.maxLength ?? 4000,
      blockPatterns: config.blockPatterns ?? [],
      warnPatterns: config.warnPatterns ?? [],
      allowedTopics: config.allowedTopics ?? COMMERCE_KEYWORDS,
      strictMode: config.strictMode ?? false,
    };
    this.customBlockPatterns = this.config.blockPatterns;
    this.customWarnPatterns = this.config.warnPatterns;
  }

  /**
   * Sanitize user input and check for prompt injection attempts
   */
  sanitize(input: string): SanitizationResult {
    const violations: string[] = [];
    let riskScore = 0;
    let sanitized = input;

    // Check length
    if (input.length > this.config.maxLength) {
      violations.push(`input_too_long: ${input.length} > ${this.config.maxLength}`);
      sanitized = input.slice(0, this.config.maxLength);
      riskScore += 10;
    }

    // Check for built-in patterns
    for (const { pattern, severity, name } of INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        violations.push(`${severity}:${name}`);
        riskScore += severity === 'block' ? 50 : 15;
      }
    }

    // Check custom block patterns
    for (const pattern of this.customBlockPatterns) {
      if (pattern.test(input)) {
        violations.push(`block:custom_pattern`);
        riskScore += 50;
      }
    }

    // Check custom warn patterns
    for (const pattern of this.customWarnPatterns) {
      if (pattern.test(input)) {
        violations.push(`warn:custom_pattern`);
        riskScore += 15;
      }
    }

    // Check for excessive special characters (potential encoding attack)
    const specialCharRatio = (input.match(/[^\w\s.,!?'"()-]/g) || []).length / input.length;
    if (specialCharRatio > 0.3) {
      violations.push('warn:excessive_special_chars');
      riskScore += 20;
    }

    // Check for repetitive patterns (potential buffer/context stuffing)
    const repeatedPattern = /(.{10,})\1{3,}/;
    if (repeatedPattern.test(input)) {
      violations.push('warn:repetitive_content');
      riskScore += 25;
    }

    // Normalize potentially dangerous Unicode
    sanitized = this.normalizeUnicode(sanitized);

    // Determine if safe
    const hasBlockViolation = violations.some(v => v.startsWith('block:'));
    const hasWarnViolation = violations.some(v => v.startsWith('warn:'));
    const safe = !hasBlockViolation && (!this.config.strictMode || !hasWarnViolation);

    return {
      safe,
      sanitized,
      violations,
      riskScore: Math.min(100, riskScore),
    };
  }

  /**
   * Quick check if input is safe (doesn't return details)
   */
  isSafe(input: string): boolean {
    return this.sanitize(input).safe;
  }

  /**
   * Normalize Unicode to prevent homograph attacks
   */
  private normalizeUnicode(input: string): string {
    // Normalize to NFC form
    let normalized = input.normalize('NFC');

    // Replace common lookalike characters
    const homographs: [RegExp, string][] = [
      [/[\u0430]/g, 'a'], // Cyrillic а -> Latin a
      [/[\u0435]/g, 'e'], // Cyrillic е -> Latin e
      [/[\u043E]/g, 'o'], // Cyrillic о -> Latin o
      [/[\u0440]/g, 'p'], // Cyrillic р -> Latin p
      [/[\u0441]/g, 'c'], // Cyrillic с -> Latin c
      [/[\u0445]/g, 'x'], // Cyrillic х -> Latin x
      [/[\u0443]/g, 'y'], // Cyrillic у -> Latin y
      [/[\u200B-\u200D\uFEFF]/g, ''], // Zero-width characters
    ];

    for (const [pattern, replacement] of homographs) {
      normalized = normalized.replace(pattern, replacement);
    }

    return normalized;
  }

  /**
   * Check if the input seems related to allowed commerce topics
   */
  isOnTopic(input: string): boolean {
    const lowerInput = input.toLowerCase();
    return this.config.allowedTopics.some(topic => lowerInput.includes(topic));
  }

  /**
   * Get a safe rejection message (doesn't reveal detection details)
   */
  static getRejectionMessage(): string {
    return "I can only help with shopping and commerce-related tasks. Could you please rephrase your request?";
  }

  /**
   * Log violation for monitoring (implement your own logger)
   */
  static logViolation(input: string, result: SanitizationResult): void {
    // In production, send to your logging/monitoring system
    console.warn('[SANITIZER] Potential injection detected:', {
      inputLength: input.length,
      riskScore: result.riskScore,
      violations: result.violations,
      // Don't log the actual input in production - could be used for recon
      inputPreview: input.slice(0, 50) + '...',
    });
  }
}

// Export singleton with default config
export const defaultSanitizer = new PromptSanitizer();
