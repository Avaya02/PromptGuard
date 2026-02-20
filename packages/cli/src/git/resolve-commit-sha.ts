import { execa } from "execa";

export async function resolveCommitSha(cwd: string): Promise<string> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim();
  } catch {
    return "unknown";
  }
}
