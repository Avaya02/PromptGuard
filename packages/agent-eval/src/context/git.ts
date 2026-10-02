import { execFile } from "node:child_process";

export class GitError extends Error {
  readonly args: string[];
  readonly stderr: string;

  constructor(args: string[], stderr: string) {
    super(`git ${args.join(" ")} failed: ${stderr.trim() || "unknown error"}`);
    this.name = "GitError";
    this.args = args;
    this.stderr = stderr;
  }
}

// Identity for commits diditbreak makes inside throwaway sandboxes, so they
// work on machines with no global git identity (CI runners included).
const SANDBOX_IDENTITY = ["-c", "user.name=diditbreak", "-c", "user.email=diditbreak@localhost"];

function run(args: string[], cwd: string, binary: boolean): Promise<Buffer | string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: 64 * 1024 * 1024, encoding: binary ? "buffer" : "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(new GitError(args, String(stderr)));
          return;
        }
        resolvePromise(stdout);
      }
    );
  });
}

export async function git(args: string[], cwd: string): Promise<string> {
  return (await run(args, cwd, false)) as string;
}

export async function gitBuffer(args: string[], cwd: string): Promise<Buffer> {
  return (await run(args, cwd, true)) as Buffer;
}

export async function gitCommitAll(cwd: string, message: string): Promise<void> {
  await git(["add", "-A"], cwd);
  await git([...SANDBOX_IDENTITY, "commit", "-q", "--no-verify", "--allow-empty", "-m", message], cwd);
}

export async function repoRoot(cwd: string): Promise<string> {
  return (await git(["rev-parse", "--show-toplevel"], cwd)).trim();
}

/** NUL-separated output, which survives file names with spaces or newlines. */
export function splitNul(output: string): string[] {
  return output.split("\0").filter((entry) => entry.length > 0);
}
