/**
 * @wytcab/projection-core/llm
 *
 * LLM provider implementation. Wraps the Anthropic Node SDK and routes
 * to either Anthropic's native endpoint or DeepSeek's Anthropic-compatible
 * endpoint based on model name.
 *
 * Routing rule:
 *   - claude-* models  -> Anthropic endpoint, ANTHROPIC_API_KEY
 *   - deepseek-* models -> DeepSeek endpoint, DEEPSEEK_API_KEY
 *
 * The DeepSeek endpoint silently maps unknown model names to deepseek-v4-flash,
 * which would let `claude-sonnet-4-6` requests succeed but use the wrong model.
 * To prevent that, we explicitly route by model prefix and refuse mismatches.
 *
 * Copyright (c) 2026 Vilhelm Drosjer
 * MIT License.
 */

import Anthropic from "@anthropic-ai/sdk";

import type {
  ProviderHandle,
  ProviderRequest,
  ProviderResponse,
} from "./lens.js";

// =============================================================================
// Constants
// =============================================================================

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

/** Default model identifier when none is specified by the wrapper. */
export const DEFAULT_MODEL = "deepseek-v4-flash";

/**
 * Model-name prefix routing. Returned value tells the caller which
 * environment variable holds the API key and which base URL to use.
 */
export type ProviderTarget = "anthropic" | "deepseek";

export function detectProviderFromModel(model: string): ProviderTarget {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("deepseek-")) return "deepseek";
  // Refuse to guess. Wrapper should pick a model with an explicit prefix.
  throw new Error(
    `Cannot infer provider from model name '${model}'. ` +
      `Use a model name starting with 'claude-' or 'deepseek-'.`,
  );
}

// =============================================================================
// Pricing
// =============================================================================

export interface ModelPricing {
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}

/**
 * Default pricing in USD per million tokens. Verify against current provider
 * docs before relying on these numbers for billing-grade accuracy. Override
 * via `MakeProviderOptions.pricing`.
 *
 * Sources:
 *   - DeepSeek: https://api-docs.deepseek.com (V4 family)
 *   - Anthropic: https://docs.claude.com (current Claude model pricing)
 */
export const DEFAULT_PRICING: Readonly<Record<string, ModelPricing>> = {
  // DeepSeek V4
  "deepseek-v4-flash": { inputUsdPerMillion: 0.14, outputUsdPerMillion: 0.28 },
  "deepseek-v4-pro": { inputUsdPerMillion: 0.55, outputUsdPerMillion: 2.19 },
  // Claude (Anthropic)
  "claude-sonnet-4-6": { inputUsdPerMillion: 3.0, outputUsdPerMillion: 15.0 },
  "claude-opus-4-7": { inputUsdPerMillion: 15.0, outputUsdPerMillion: 75.0 },
  "claude-haiku-4-5": { inputUsdPerMillion: 1.0, outputUsdPerMillion: 5.0 },
};

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: Readonly<Record<string, ModelPricing>> = DEFAULT_PRICING,
): number {
  const p = pricing[model];
  if (!p) return 0;
  return (
    (inputTokens * p.inputUsdPerMillion + outputTokens * p.outputUsdPerMillion) /
    1_000_000
  );
}

// =============================================================================
// Provider construction
// =============================================================================

export interface MakeProviderOptions {
  /** API key. Use the key matching the model's target provider. */
  apiKey: string;
  /**
   * Override the base URL. Defaults to:
   *   - For `target === "anthropic"`: undefined (SDK default).
   *   - For `target === "deepseek"`: DEEPSEEK_BASE_URL.
   */
  baseURL?: string;
  /** The intended target. Drives base URL selection. */
  target: ProviderTarget;
  /** Pricing override. Merged over DEFAULT_PRICING. */
  pricing?: Readonly<Record<string, ModelPricing>>;
}

/**
 * Construct a ProviderHandle.
 *
 * The returned handle calls `client.messages.create()` with the request
 * shape from `ProviderRequest`, extracts text from the response, and
 * computes cost from the token counts.
 *
 * Special handling for DeepSeek:
 *   - Disables thinking mode by default (DeepSeek V4 enables it by default,
 *     which adds latency and tokens we don't need for briefing-style output).
 *   - Refuses to send requests where `model` doesn't start with `deepseek-`,
 *     to prevent the silent-auto-mapping footgun.
 */
export function makeProvider(opts: MakeProviderOptions): ProviderHandle {
  const baseURL =
    opts.baseURL ??
    (opts.target === "deepseek" ? DEEPSEEK_BASE_URL : undefined);

  const client = new Anthropic({
    apiKey: opts.apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  const pricing: Readonly<Record<string, ModelPricing>> = {
    ...DEFAULT_PRICING,
    ...(opts.pricing ?? {}),
  };

  return {
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      // Refuse cross-provider model names
      const inferred = detectProviderFromModel(req.model);
      if (inferred !== opts.target) {
        throw new Error(
          `Provider was constructed for ${opts.target} but request model '${req.model}' targets ${inferred}. ` +
            `Construct a provider for the right target, or change the model name.`,
        );
      }

      const start = Date.now();
      const requestBody: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens ?? 2048,
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };
      if (req.system !== undefined) requestBody.system = req.system;
      if (req.temperature !== undefined) requestBody.temperature = req.temperature;
      // Disable DeepSeek thinking mode for briefing-style use
      if (opts.target === "deepseek") {
        requestBody.thinking = { type: "disabled" };
      }

      // Cast: we allow extra fields (thinking) that aren't in the SDK's strict types
      const response = await client.messages.create(
        requestBody as unknown as Anthropic.MessageCreateParamsNonStreaming,
      );

      // Extract text from content blocks. Skip thinking blocks (DeepSeek may
      // emit them even when disabled, and we don't want them in the output).
      const text = response.content
        .filter(
          (block): block is Anthropic.TextBlock =>
            block.type === "text",
        )
        .map((block) => block.text)
        .join("");

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;

      return {
        text,
        inputTokens,
        outputTokens,
        costUsd: computeCostUsd(req.model, inputTokens, outputTokens, pricing),
        model: response.model,
        durationMs: Date.now() - start,
      };
    },
  };
}

/**
 * Convenience: construct a provider from environment variables.
 *
 * Reads:
 *   - DEEPSEEK_API_KEY for deepseek-* models
 *   - ANTHROPIC_API_KEY for claude-* models
 *
 * Throws if the matching environment variable is missing.
 */
export function makeProviderFromEnv(model: string): ProviderHandle {
  const target = detectProviderFromModel(model);
  if (target === "deepseek") {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error(
        "DEEPSEEK_API_KEY is not set. Get a key at https://platform.deepseek.com",
      );
    }
    return makeProvider({ apiKey, target: "deepseek" });
  }
  // anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com",
    );
  }
  return makeProvider({ apiKey, target: "anthropic" });
}
