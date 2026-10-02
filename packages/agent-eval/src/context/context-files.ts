import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { ContextSource } from "../types.js";
import { git, gitBuffer, splitNul } from "./git.js";

export interface ContextFile {
  path: string;
  content: Buffer;
}

/**
 * Files that shape a coding agent's behaviour rather than the code it edits.
 *
 * CLAUDE.md and AGENTS.md are picked up in any directory, because agents load
 * nested ones when they work in a subdirectory. `.claude/` holds skills,
 * subagents, slash commands and settings; `.mcp.json` declares MCP servers.
 */
const CONTEXT_FILENAMES = new Set(["CLAUDE.md", "AGENTS.md"]);
const CONTEXT_PREFIXES = [".claude/"];
const CONTEXT_EXACT = new Set([".mcp.json"]);

export function isContextPath(path: string): boolean {
  const normalised = path.replace(/\\/g, "/");
  return (
    CONTEXT_FILENAMES.has(basename(normalised)) ||
    CONTEXT_EXACT.has(normalised) ||
    CONTEXT_PREFIXES.some((prefix) => normalised.startsWith(prefix))
  );
}

/**
 * Reads the context files a variant should run with.
 *
 * "working" includes uncommitted and untracked (but not ignored) files, since
 * the common question is "is my edit better than what's committed?".
 */
export async function readContextFiles(repoRoot: string, source: ContextSource): Promise<ContextFile[]> {
  if (source.kind === "none") {
    return [];
  }

  if (source.kind === "working") {
    const listed = splitNul(
      await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], repoRoot)
    ).filter(isContextPath);

    const files: ContextFile[] = [];
    for (const path of listed.sort()) {
      try {
        files.push({ path, content: await readFile(join(repoRoot, path)) });
      } catch (error) {
        // A tracked file deleted in the working tree is simply absent here.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
    return files;
  }

  const listed = splitNul(await git(["ls-tree", "-r", "-z", "--name-only", source.ref], repoRoot))
    .filter(isContextPath)
    .sort();

  return Promise.all(
    listed.map(async (path) => ({
      path,
      content: await gitBuffer(["show", `${source.ref}:${path}`], repoRoot)
    }))
  );
}

export interface MarkdownSection {
  heading: string;
  level: number;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Sections worth ablating: the shallowest heading level that occurs more than
 * once. A CLAUDE.md with one "# Title" and several "## Rules" sections yields
 * the "##" sections, which is where the separable instructions live.
 */
export function listSections(markdown: string): MarkdownSection[] {
  const all: MarkdownSection[] = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    const match = inFence ? null : HEADING.exec(line);
    if (match) {
      all.push({ level: match[1]!.length, heading: match[2]! });
    }
  }

  for (let level = 1; level <= 6; level += 1) {
    const atLevel = all.filter((section) => section.level === level);
    if (atLevel.length > 1) {
      return atLevel;
    }
  }

  return all;
}

/**
 * Removes one section: its heading line and everything up to the next heading
 * of the same or a higher level. Headings inside code fences are ignored.
 */
export function removeSection(markdown: string, heading: string): { text: string; removed: boolean } {
  const lines = markdown.split("\n");
  const target = heading.trim().toLowerCase();
  const out: string[] = [];
  let skippingLevel: number | null = null;
  let removed = false;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    }

    const match = inFence ? null : HEADING.exec(line);

    if (match) {
      const level = match[1]!.length;
      if (skippingLevel !== null && level <= skippingLevel) {
        skippingLevel = null;
      }
      if (skippingLevel === null && match[2]!.trim().toLowerCase() === target) {
        skippingLevel = level;
        removed = true;
        continue;
      }
    }

    if (skippingLevel === null) {
      out.push(line);
    }
  }

  return { text: out.join("\n"), removed };
}
