export interface Interval {
  low: number;
  high: number;
}

/**
 * Wilson score interval for a pass rate. Unlike the textbook normal
 * approximation it behaves at the small sample sizes agent experiments have,
 * including 0/n and n/n, where the normal interval collapses to zero width.
 */
export function wilsonInterval(successes: number, trials: number, z = 1.96): Interval {
  if (trials === 0) {
    return { low: 0, high: 1 };
  }
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pass/fail outcomes for one task under the two setups being compared. */
export interface PairedTaskOutcomes {
  reference: boolean[];
  candidate: boolean[];
}

export interface DifferenceEstimate extends Interval {
  /** Candidate pass rate minus reference pass rate, averaged over tasks. */
  mean: number;
}

function rate(outcomes: boolean[]): number {
  return outcomes.length === 0 ? 0 : outcomes.filter(Boolean).length / outcomes.length;
}

function resample<T>(items: T[], random: () => number): T[] {
  return items.map(() => items[Math.floor(random() * items.length)]!);
}

/**
 * Two-level bootstrap for the difference in pass rate between two setups.
 *
 * Trials of the same task are not independent (a hard task is hard for both
 * setups), so tasks are resampled first and trials within each task second.
 * Comparing per task, rather than pooling all runs, removes task difficulty
 * from the comparison: that is the "paired" part.
 *
 * Seeded, so the same results always produce the same interval.
 */
export function pairedBootstrap(
  tasks: PairedTaskOutcomes[],
  options: { iterations?: number; seed?: number; confidence?: number } = {}
): DifferenceEstimate {
  const usable = tasks.filter((task) => task.reference.length > 0 && task.candidate.length > 0);
  if (usable.length === 0) {
    return { mean: 0, low: 0, high: 0 };
  }

  const iterations = options.iterations ?? 2000;
  const confidence = options.confidence ?? 0.95;
  const random = createRandom(options.seed ?? 20261002);

  const meanDifference = (sample: PairedTaskOutcomes[], inner: boolean): number => {
    let total = 0;
    for (const task of sample) {
      const reference = inner ? resample(task.reference, random) : task.reference;
      const candidate = inner ? resample(task.candidate, random) : task.candidate;
      total += rate(candidate) - rate(reference);
    }
    return total / sample.length;
  };

  const estimates: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    estimates.push(meanDifference(resample(usable, random), true));
  }
  estimates.sort((a, b) => a - b);

  const tail = (1 - confidence) / 2;
  return {
    mean: meanDifference(usable, false),
    low: estimates[Math.floor(tail * (iterations - 1))]!,
    high: estimates[Math.ceil((1 - tail) * (iterations - 1))]!
  };
}

export function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}
