/**
 * @wytcab/projection-core/output
 *
 * Output validation, serialization, and path conventions.
 *
 * Copyright (c) 2026 Vilhelm Drosjer
 * MIT License.
 */

import path from "node:path";

import type { LensOutput } from "./lens.js";

/**
 * Type-narrowing assertion that `output` is a valid `LensOutput`.
 * Useful when receiving lens output across a serialization boundary
 * (file, IPC, MCP tool response).
 */
export function validateOutput(output: unknown): asserts output is LensOutput {
  if (!output || typeof output !== "object") {
    throw new Error("Output is not an object");
  }
  const o = output as Record<string, unknown>;
  if (typeof o.markdown !== "string") {
    throw new Error("Output.markdown is not a string");
  }
  if (!o.meta || typeof o.meta !== "object") {
    throw new Error("Output.meta is missing or not an object");
  }
  const m = o.meta as Record<string, unknown>;
  for (const key of ["lensName", "lensVersion", "model"]) {
    if (typeof m[key] !== "string") {
      throw new Error(`Output.meta.${key} is not a string`);
    }
  }
  for (const key of ["inputTokens", "outputTokens", "costUsd", "durationMs"]) {
    if (typeof m[key] !== "number") {
      throw new Error(`Output.meta.${key} is not a number`);
    }
  }
  if (!(m.generatedAt instanceof Date)) {
    throw new Error("Output.meta.generatedAt is not a Date");
  }
}

/**
 * Serialize a LensOutput as a markdown document with YAML frontmatter
 * carrying the OutputMeta. The body is the lens's markdown output verbatim.
 *
 * Output is byte-for-byte stable across calls with the same input
 * (modulo Date.toISOString precision), suitable for diffing fixture results.
 */
export function serializeOutput(output: LensOutput): string {
  const m = output.meta;
  const frontmatter = [
    "---",
    `lens: ${m.lensName}`,
    `lens-version: ${m.lensVersion}`,
    `model: ${m.model}`,
    `input-tokens: ${m.inputTokens}`,
    `output-tokens: ${m.outputTokens}`,
    `cost-usd: ${m.costUsd.toFixed(6)}`,
    `duration-ms: ${m.durationMs}`,
    `generated-at: ${m.generatedAt.toISOString()}`,
    "---",
    "",
  ].join("\n");
  // Ensure body ends with a single trailing newline
  const body = output.markdown.endsWith("\n") ? output.markdown : output.markdown + "\n";
  return frontmatter + body;
}

/**
 * Default path for a lens's saved output, scoped under a hidden directory
 * named after the lens.
 *
 * Pattern: `<projectRoot>/.<lensName>/briefings/YYYY-MM-DD.md`
 *
 * If a briefing already exists for the same date, the lens or wrapper is
 * responsible for handling collision (typically by suffixing with HH-mm-ss
 * or by writing alongside).
 */
export function defaultBriefingPath(
  projectRoot: string,
  lensName: string,
  date: Date = new Date(),
): string {
  const ymd = date.toISOString().slice(0, 10);
  return path.join(projectRoot, `.${lensName}`, "briefings", `${ymd}.md`);
}
