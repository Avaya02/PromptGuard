import { spawn } from "node:child_process";

export interface ShellResult {
  exitCode: number;
  /** Tail of combined stdout and stderr. */
  output: string;
  timedOut: boolean;
}

const OUTPUT_TAIL_BYTES = 4000;

/**
 * Runs a shell command with a hard timeout, keeping only the tail of output:
 * a failing test suite can print megabytes, and the end is where the reason is.
 */
export function runShell(command: string, cwd: string, timeoutMs: number): Promise<ShellResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("sh", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group, so a timeout can kill the whole tree, not just sh.
      detached: true
    });

    let output = "";
    const append = (chunk: Buffer): void => {
      output = (output + chunk.toString("utf-8")).slice(-OUTPUT_TAIL_BYTES);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: timedOut ? 124 : (code ?? 1),
        output: timedOut ? `${output}\n[timed out after ${timeoutMs}ms]` : output,
        timedOut
      });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: 127, output: error.message, timedOut: false });
    });
  });
}
