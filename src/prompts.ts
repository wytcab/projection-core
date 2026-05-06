/**
 * @wytcab/projection-core/prompts
 *
 * Prompt template loading and rendering.
 *
 * Templates are .md files with optional YAML frontmatter and {{var}}
 * placeholders in the body. Lenses load templates from their package's
 * prompts/ directory and render them with corpus-derived variables.
 *
 * The frontmatter parser is intentionally minimal — it handles `key: value`
 * lines and quoted strings, nothing more. Lenses that need richer metadata
 * should layer their own parsing on top of `frontmatter`.
 *
 * Copyright (c) 2026 Vilhelm Drosjer
 * MIT License.
 */

import fs from "node:fs/promises";

export interface PromptTemplate {
  /** Frontmatter as a flat key/value map. Empty object if no frontmatter. */
  readonly frontmatter: Readonly<Record<string, string>>;
  /** Body text after the frontmatter, with leading/trailing whitespace preserved. */
  readonly body: string;
  /** Path the template was loaded from (for error messages). */
  readonly source: string;
}

/**
 * Load a prompt template from disk. The file may begin with YAML frontmatter
 * delimited by `---` lines; if present, frontmatter keys are parsed.
 * Body is everything after the closing `---`, or the whole file if no frontmatter.
 */
export async function loadPromptTemplate(filePath: string): Promise<PromptTemplate> {
  const content = await fs.readFile(filePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(content);
  return { frontmatter, body, source: filePath };
}

/**
 * Parse minimal `key: value` YAML frontmatter from a string.
 * Recognizes:
 *   - The opening `---` must be on the very first line.
 *   - Closing `---` ends the frontmatter; everything after is body.
 *   - Lines inside frontmatter are `key: value`. Quoted values are unquoted.
 *   - Lines starting with `#` inside frontmatter are skipped.
 * Anything more complex (lists, nested objects, multiline scalars) is not supported.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: {}, body: content };
  }
  const newlineLen = content.startsWith("---\r\n") ? 5 : 4;
  const rest = content.slice(newlineLen);
  // Find closing ---
  const closeMatch = /\n---\r?\n/.exec(rest);
  if (!closeMatch || closeMatch.index === undefined) {
    return { frontmatter: {}, body: content };
  }
  const fmText = rest.slice(0, closeMatch.index);
  const body = rest.slice(closeMatch.index + closeMatch[0].length);
  const fm: Record<string, string> = {};
  for (const rawLine of fmText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // Strip matching quotes
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }
  return { frontmatter: fm, body };
}

/**
 * Render a template body with `{{var}}` substitutions.
 *
 * Throws if any placeholder is not provided in `vars` — fail loud beats
 * silently shipping prompts with literal `{{foo}}` strings to the model.
 *
 * `{{` and `}}` can be escaped as `\{\{` and `\}\}` if a literal is needed.
 */
export function renderPromptTemplate(
  tpl: PromptTemplate,
  vars: Readonly<Record<string, string>>,
): string {
  const placeholderRegex = /(\\\{\\\{|\{\{(\w+)\}\}|\\\}\\\})/g;
  let lastIndex = 0;
  let result = "";
  for (const match of tpl.body.matchAll(placeholderRegex)) {
    const idx = match.index;
    if (idx === undefined) continue;
    result += tpl.body.slice(lastIndex, idx);
    const [whole, _esc, varName] = match;
    if (whole === "\\{\\{") {
      result += "{{";
    } else if (whole === "\\}\\}") {
      result += "}}";
    } else if (varName !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(vars, varName)) {
        throw new Error(
          `Prompt template ${tpl.source} references {{${varName}}} but no value was provided.`,
        );
      }
      result += vars[varName];
    }
    lastIndex = idx + whole.length;
  }
  result += tpl.body.slice(lastIndex);
  return result;
}
