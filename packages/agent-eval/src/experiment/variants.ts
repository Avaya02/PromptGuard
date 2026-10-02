import type { ContextFile } from "../context/context-files.js";
import { listSections } from "../context/context-files.js";
import type { ContextSource, Variant } from "../types.js";

export const BASELINE = "none";
export const WORKING = "working";

/**
 * A setup token from the command line:
 *   working  -> the context files in your working tree, uncommitted edits included
 *   none     -> no context files at all
 *   anything else -> a git ref (branch, tag, commit) to take the context from
 */
export function variantFromToken(token: string): Variant {
  const context: ContextSource =
    token === WORKING ? { kind: "working" } : token === BASELINE ? { kind: "none" } : { kind: "ref", ref: token };
  return { name: token, context, remove: [], removeSections: [] };
}

/**
 * Setups for a comparison. The "none" baseline is added unless asked not to:
 * research on AGENTS.md files found agents often do better with no context
 * file at all, so "is this better than nothing?" belongs in every comparison.
 */
export function buildVariants(tokens: string[], options: { baseline: boolean }): Variant[] {
  const requested = tokens.length > 0 ? tokens : ["HEAD", WORKING];
  const ordered = options.baseline && !requested.includes(BASELINE) ? [BASELINE, ...requested] : requested;
  return [...new Set(ordered)].map(variantFromToken);
}

export interface AblationPlan {
  variants: Variant[];
  /** Variant name to what it removes, for the report. */
  removed: Record<string, string>;
}

/**
 * Leave-one-out ablation: the full context plus one variant per removable
 * part, each with exactly that part missing. A part whose removal improves
 * results is hurting the agent; one whose removal changes nothing is costing
 * tokens for no benefit.
 */
export function planAblation(
  source: ContextSource,
  contextFiles: ContextFile[],
  options: { file: string; includeSkills: boolean }
): AblationPlan {
  const full: Variant = { name: "full", context: source, remove: [], removeSections: [] };
  const variants: Variant[] = [full];
  const removed: Record<string, string> = {};

  const target = contextFiles.find((file) => file.path === options.file);
  if (target) {
    for (const section of listSections(target.content.toString("utf-8"))) {
      const name = `no-section-${section.heading}`;
      variants.push({
        name,
        context: source,
        remove: [],
        removeSections: [{ file: options.file, heading: section.heading }]
      });
      removed[name] = `${options.file} › ${section.heading}`;
    }
  }

  if (options.includeSkills) {
    const skills = new Set(
      contextFiles
        .map((file) => /^\.claude\/skills\/([^/]+)\//.exec(file.path)?.[1])
        .filter((skill): skill is string => skill !== undefined)
    );
    for (const skill of [...skills].sort()) {
      const name = `no-skill-${skill}`;
      variants.push({ name, context: source, remove: [`.claude/skills/${skill}`], removeSections: [] });
      removed[name] = `skill ${skill}`;
    }
  }

  return { variants, removed };
}
