/**
 * @wytcab/projection-core
 *
 * Lens interface for Project Coxswain.
 *
 * A "lens" is a transformation applied to a corpus the user already has.
 * Each lens shares the same execution shape (corpus + config -> output)
 * but provides its own prompt scaffolding and output schema.
 *
 * Lenses are consumed by four wrappers in this codebase:
 *   - CLI: `npx @wytcab/<lens>`
 *   - MCP server (Anthropic Node SDK)
 *   - Paperclip extension
 *   - Claude Code SKILL.md
 *
 * The same Lens object powers all four. Wrappers handle their own I/O;
 * the lens itself is pure transformation.
 *
 * Copyright (c) 2026 Vilhelm Drosjer
 * MIT License (see LICENSE at repo root).
 */

// =============================================================================
// Lens
// =============================================================================

/**
 * The core interface every lens implements.
 *
 * `TConfig` and `TOutput` allow each lens to extend the default shapes
 * with lens-specific configuration knobs and output fields. Lenses that
 * need no extension can use the defaults: `Lens` (with no type args) is
 * equivalent to `Lens<LensConfig, LensOutput>`.
 */
export interface Lens<TConfig extends LensConfig = LensConfig, TOutput extends LensOutput = LensOutput> {
  /** Stable identifier. snake_case, lowercase, no version. e.g. "nousboot". */
  readonly name: string;

  /** SemVer of this specific lens. Independent of `@wytcab/projection-core` version. */
  readonly version: string;

  /** One-sentence human description. Surfaced by MCP `tools/list` and CLI `--help`. */
  readonly description: string;

  /**
   * Optional pre-flight check. Wrappers SHOULD call this before `run()` to
   * surface user-facing errors early ("your corpus is missing CLAUDE.md").
   * If validation fails, throw `LensValidationError` with a user-readable
   * message. The optional `hint` field on the error is shown as a separate line.
   */
  validate?(corpus: Corpus, config: TConfig): void | Promise<void>;

  /**
   * Run the transformation. The wrapper has already assembled `corpus`;
   * the lens is responsible only for the pure data flow.
   * Errors thrown propagate to the wrapper for user-facing reporting.
   */
  run(corpus: Corpus, config: TConfig): Promise<TOutput>;
}

// =============================================================================
// Corpus
// =============================================================================

/**
 * The input data the lens transforms. Assembled by the calling wrapper.
 * The lens itself does NOT touch the filesystem; that is the wrapper's job.
 * This separation keeps lenses pure, testable, and trivially fixture-able.
 */
export interface Corpus {
  readonly files: ReadonlyArray<CorpusFile>;
  readonly metadata: CorpusMetadata;
}

export interface CorpusFile {
  /** Relative path within the corpus, e.g. "README.md" or "src/index.ts". */
  readonly path: string;
  /** Full text content. Wrappers handle binary detection and skip non-text. */
  readonly content: string;
  /** Last-modified time, if known. */
  readonly mtime?: Date;
  /** Byte size, if known. */
  readonly size?: number;
}

/**
 * Wrapper-supplied context. The keys below are well-known. Wrappers may
 * attach additional fields under any other string key for lens-specific use.
 */
export interface CorpusMetadata {
  /** Absolute path of corpus root, if disk-backed. */
  readonly rootPath?: string;
  /** Git HEAD SHA, if git-backed. */
  readonly gitSha?: string;
  /** Recent git log, if available. Wrappers decide how many entries to include. */
  readonly gitLog?: ReadonlyArray<GitLogEntry>;
  /** When the wrapper assembled this corpus. */
  readonly capturedAt: Date;
  /** Wrapper-specific extensions. */
  readonly [key: string]: unknown;
}

export interface GitLogEntry {
  readonly sha: string;
  readonly author: string;
  readonly date: Date;
  readonly subject: string;
}

// =============================================================================
// Config
// =============================================================================

/** Default config shape; lenses extend with their own. */
export interface LensConfig {
  /** LLM provider handle, supplied by the wrapper. The lens never sees keys/URLs. */
  readonly provider: ProviderHandle;
  /** Model identifier, e.g. "deepseek-v4-flash", "claude-sonnet-4-6". */
  readonly model: string;
  /** Lens-specific extra configuration. Lenses extending the interface should
   *  prefer adding strongly-typed fields over stuffing things in `extra`. */
  readonly extra?: Record<string, unknown>;
}

// =============================================================================
// Output
// =============================================================================

/** Default output shape; lenses extend with their own. */
export interface LensOutput {
  /** Primary output as markdown, suitable for stdout / file / MCP tool result. */
  readonly markdown: string;
  /** Execution metadata (cost, tokens, duration). */
  readonly meta: OutputMeta;
}

export interface OutputMeta {
  readonly lensName: string;
  readonly lensVersion: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly generatedAt: Date;
}

// =============================================================================
// Provider
// =============================================================================

/**
 * Opaque LLM handle. The lens uses this to call the model; the wrapper
 * supplies an implementation that talks to the actual API (Anthropic Node
 * SDK pointed at DeepSeek's Anthropic-compatible endpoint by default,
 * Anthropic, or any OpenAI-compatible provider via a separate adapter).
 *
 * The lens does NOT see API keys, base URLs, or raw HTTP. This isolation
 * is what makes the same lens object work across CLI, MCP, Paperclip, and
 * Claude Code wrappers without modification.
 *
 * Wave 3 ships the canonical Anthropic-SDK-pointed-at-DeepSeek implementation.
 */
export interface ProviderHandle {
  generate(req: ProviderRequest): Promise<ProviderResponse>;
}

export interface ProviderRequest {
  readonly model: string;
  readonly system?: string;
  readonly messages: ReadonlyArray<ProviderMessage>;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface ProviderMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ProviderResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly model: string;
  readonly durationMs: number;
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown by `Lens.validate()` when input validation fails.
 * Wrappers should catch and present `message` plus optional `hint` to the user.
 */
export class LensValidationError extends Error {
  public readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "LensValidationError";
    this.hint = hint;
  }
}
