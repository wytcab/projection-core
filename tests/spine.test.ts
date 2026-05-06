/**
 * Tests for @wytcab/projection-core spine modules.
 *
 * Covers prompts (parser + renderer), llm (routing + cost computation),
 * and output (serialization). No tests hit a real LLM API.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEEPSEEK_BASE_URL,
  DEFAULT_PRICING,
  computeCostUsd,
  detectProviderFromModel,
  parseFrontmatter,
  renderPromptTemplate,
  serializeOutput,
  validateOutput,
} from "../src/index.js";

// =============================================================================
// prompts.parseFrontmatter
// =============================================================================

test("parseFrontmatter: empty content", () => {
  const { frontmatter, body } = parseFrontmatter("");
  assert.deepEqual(frontmatter, {});
  assert.equal(body, "");
});

test("parseFrontmatter: no frontmatter", () => {
  const { frontmatter, body } = parseFrontmatter("just body text\nline two");
  assert.deepEqual(frontmatter, {});
  assert.equal(body, "just body text\nline two");
});

test("parseFrontmatter: simple key/value", () => {
  const text = "---\nname: nousboot\nversion: 1.0.0\n---\nbody here";
  const { frontmatter, body } = parseFrontmatter(text);
  assert.deepEqual(frontmatter, { name: "nousboot", version: "1.0.0" });
  assert.equal(body, "body here");
});

test("parseFrontmatter: quoted values", () => {
  const text = '---\ndesc: "hello world"\nkey: \'single\'\n---\nbody';
  const { frontmatter } = parseFrontmatter(text);
  assert.equal(frontmatter.desc, "hello world");
  assert.equal(frontmatter.key, "single");
});

test("parseFrontmatter: comments and blank lines skipped", () => {
  const text = "---\n# comment\n\nname: x\n---\nbody";
  const { frontmatter } = parseFrontmatter(text);
  assert.deepEqual(frontmatter, { name: "x" });
});

test("parseFrontmatter: missing close treated as no frontmatter", () => {
  const text = "---\nname: x\nno close";
  const { frontmatter, body } = parseFrontmatter(text);
  assert.deepEqual(frontmatter, {});
  assert.equal(body, text);
});

// =============================================================================
// prompts.renderPromptTemplate
// =============================================================================

test("renderPromptTemplate: simple substitution", () => {
  const tpl = { frontmatter: {}, body: "Hello {{name}}!", source: "test" };
  const result = renderPromptTemplate(tpl, { name: "World" });
  assert.equal(result, "Hello World!");
});

test("renderPromptTemplate: multiple vars", () => {
  const tpl = {
    frontmatter: {},
    body: "{{a}} and {{b}} and {{a}} again",
    source: "test",
  };
  const result = renderPromptTemplate(tpl, { a: "X", b: "Y" });
  assert.equal(result, "X and Y and X again");
});

test("renderPromptTemplate: throws on missing var", () => {
  const tpl = { frontmatter: {}, body: "Hello {{missing}}", source: "test" };
  assert.throws(
    () => renderPromptTemplate(tpl, {}),
    /references \{\{missing\}\}/,
  );
});

test("renderPromptTemplate: no placeholders passes through", () => {
  const tpl = { frontmatter: {}, body: "no vars here", source: "test" };
  assert.equal(renderPromptTemplate(tpl, {}), "no vars here");
});

// =============================================================================
// llm.detectProviderFromModel
// =============================================================================

test("detectProviderFromModel: claude routes to anthropic", () => {
  assert.equal(detectProviderFromModel("claude-sonnet-4-6"), "anthropic");
  assert.equal(detectProviderFromModel("claude-opus-4-7"), "anthropic");
  assert.equal(detectProviderFromModel("claude-haiku-4-5"), "anthropic");
});

test("detectProviderFromModel: deepseek routes to deepseek", () => {
  assert.equal(detectProviderFromModel("deepseek-v4-flash"), "deepseek");
  assert.equal(detectProviderFromModel("deepseek-v4-pro"), "deepseek");
});

test("detectProviderFromModel: unknown prefix throws", () => {
  assert.throws(() => detectProviderFromModel("gpt-4"), /Cannot infer provider/);
  assert.throws(() => detectProviderFromModel("llama-3"), /Cannot infer provider/);
});

test("DEEPSEEK_BASE_URL is the canonical Anthropic-compatible endpoint", () => {
  assert.equal(DEEPSEEK_BASE_URL, "https://api.deepseek.com/anthropic");
});

// =============================================================================
// llm.computeCostUsd
// =============================================================================

test("computeCostUsd: deepseek v4 flash", () => {
  // 1M input + 1M output at $0.14 + $0.28 = $0.42
  const cost = computeCostUsd("deepseek-v4-flash", 1_000_000, 1_000_000);
  assert.ok(Math.abs(cost - 0.42) < 1e-9);
});

test("computeCostUsd: claude sonnet", () => {
  // 1M input + 1M output at $3 + $15 = $18
  const cost = computeCostUsd("claude-sonnet-4-6", 1_000_000, 1_000_000);
  assert.ok(Math.abs(cost - 18) < 1e-9);
});

test("computeCostUsd: small token count", () => {
  // 1000 input + 500 output at deepseek-v4-flash rates
  const cost = computeCostUsd("deepseek-v4-flash", 1000, 500);
  // 1000 * 0.14 / 1M + 500 * 0.28 / 1M = 0.00014 + 0.00014 = 0.00028
  assert.ok(Math.abs(cost - 0.00028) < 1e-9);
});

test("computeCostUsd: unknown model returns 0", () => {
  assert.equal(computeCostUsd("nonexistent-model", 1000, 500), 0);
});

test("DEFAULT_PRICING contains deepseek and claude entries", () => {
  assert.ok(DEFAULT_PRICING["deepseek-v4-flash"]);
  assert.ok(DEFAULT_PRICING["deepseek-v4-pro"]);
  assert.ok(DEFAULT_PRICING["claude-sonnet-4-6"]);
});

// =============================================================================
// output.serializeOutput
// =============================================================================

test("serializeOutput: round-trips through validateOutput", () => {
  const output = {
    markdown: "## Hello\n\nbody\n",
    meta: {
      lensName: "test",
      lensVersion: "0.1.0",
      model: "deepseek-v4-flash",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.0001,
      durationMs: 123,
      generatedAt: new Date("2026-05-06T20:00:00Z"),
    },
  };
  validateOutput(output);
  const serialized = serializeOutput(output);
  assert.match(serialized, /^---\n/);
  assert.match(serialized, /\nlens: test\n/);
  assert.match(serialized, /\nlens-version: 0\.1\.0\n/);
  assert.match(serialized, /\ncost-usd: 0\.000100\n/);
  assert.match(serialized, /\n## Hello\n/);
  // Body has trailing newline
  assert.ok(serialized.endsWith("\n"));
});

test("validateOutput: rejects missing fields", () => {
  assert.throws(() => validateOutput({}), /markdown is not a string/);
  assert.throws(() => validateOutput({ markdown: "x" }), /meta is missing/);
  assert.throws(
    () => validateOutput({ markdown: "x", meta: { lensName: "y" } }),
    /lensVersion/,
  );
});
