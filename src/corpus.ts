/**
 * @wytcab/projection-core/corpus
 *
 * Corpus assembly. Reads a list of files from disk and captures recent
 * git log into a Corpus object that lenses can transform.
 *
 * The lens itself never touches the filesystem; corpus assembly is the
 * wrapper's job, and `readCorpus` is the canonical implementation of
 * "wrapper" file reading.
 *
 * Copyright (c) 2026 Vilhelm Drosjer
 * MIT License.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  Corpus,
  CorpusFile,
  CorpusMetadata,
  GitLogEntry,
} from "./lens.js";

const execFileP = promisify(execFile);

export interface ReadCorpusOptions {
  /** Absolute or resolvable path to the project root. */
  rootPath: string;
  /**
   * Files to attempt to read, relative to `rootPath`.
   * Missing files are silently skipped (they just don't appear in `corpus.files`).
   * Default: ["README.md", "CLAUDE.md", "package.json"].
   */
  files?: string[];
  /** Max bytes per file. Files larger than this are skipped. Default: 200_000. */
  maxFileSize?: number;
  /** How many recent commits to capture in metadata.gitLog. Default: 20. */
  gitLogLimit?: number;
}

const DEFAULT_FILES = ["README.md", "CLAUDE.md", "package.json"];
const DEFAULT_MAX_FILE_SIZE = 200_000;
const DEFAULT_GIT_LOG_LIMIT = 20;

/**
 * Read a corpus from a project root on disk.
 *
 * Throws if `rootPath` does not exist or is not a directory.
 * Does NOT throw if individual files are missing or git is not available;
 * those cases produce a corpus with fewer files / no git log.
 */
export async function readCorpus(opts: ReadCorpusOptions): Promise<Corpus> {
  const rootPath = path.resolve(opts.rootPath);
  const files = opts.files ?? DEFAULT_FILES;
  const maxFileSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const gitLogLimit = opts.gitLogLimit ?? DEFAULT_GIT_LOG_LIMIT;

  // Verify root exists and is a directory
  const rootStat = await fs.stat(rootPath).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`Corpus root is not a directory: ${rootPath}`);
  }

  // Read each file (skip missing, skip oversized)
  const corpusFiles: CorpusFile[] = [];
  for (const relPath of files) {
    const absPath = path.join(rootPath, relPath);
    const stat = await fs.stat(absPath).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    if (stat.size > maxFileSize) continue;
    const content = await fs.readFile(absPath, "utf8").catch(() => null);
    if (content === null) continue;
    corpusFiles.push({
      path: relPath,
      content,
      mtime: stat.mtime,
      size: stat.size,
    });
  }

  // Capture git log (best effort)
  const gitLog = await readGitLog(rootPath, gitLogLimit);
  const gitSha = await readGitSha(rootPath);

  const metadata: CorpusMetadata = {
    rootPath,
    capturedAt: new Date(),
    ...(gitLog ? { gitLog } : {}),
    ...(gitSha ? { gitSha } : {}),
  };

  return {
    files: corpusFiles,
    metadata,
  };
}

/**
 * Run `git log` for the most recent N commits at `rootPath`.
 * Returns null if not a git repo or git is not available.
 */
export async function readGitLog(
  rootPath: string,
  limit: number,
): Promise<readonly GitLogEntry[] | null> {
  const sep = "\u0000"; // null byte: safe field separator
  const recordSep = "\u0001"; // SOH: safe record separator
  const format = ["%H", "%an", "%aI", "%s"].join(sep) + recordSep;
  try {
    const { stdout } = await execFileP(
      "git",
      ["-C", rootPath, "log", `-n`, String(limit), `--format=${format}`],
      { maxBuffer: 4_000_000 },
    );
    const records = stdout.split(recordSep).filter((r) => r.length > 0);
    const entries: GitLogEntry[] = [];
    for (const rec of records) {
      const fields = rec.split(sep);
      if (fields.length < 4) continue;
      const sha = fields[0];
      const author = fields[1];
      const dateStr = fields[2];
      const subject = fields[3];
      if (!sha || !author || !dateStr || subject === undefined) continue;
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) continue;
      entries.push({ sha, author, date, subject });
    }
    return entries;
  } catch {
    return null;
  }
}

/**
 * Read HEAD sha at rootPath. Returns null if not a git repo.
 */
export async function readGitSha(rootPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP("git", ["-C", rootPath, "rev-parse", "HEAD"]);
    const sha = stdout.trim();
    return sha.length === 40 ? sha : null;
  } catch {
    return null;
  }
}
