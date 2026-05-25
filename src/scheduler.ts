/**
 * Claudine Bot - Scheduler
 *
 * Single-tick periodic scheduler. v1 uses one global cadence for all
 * scheduled work (currently just the Jira digest). Per-project cron and
 * multiple parallel jobs land later.
 */

let timer: NodeJS.Timeout | null = null;
let currentInterval: number | null = null;

export interface Task {
  name: string;
  run: () => Promise<void>;
}

/**
 * Start the scheduler. Runs each task immediately (so we see startup-time
 * effects) and then on a repeating interval.
 *
 * @param intervalMinutes  cadence in minutes
 * @param tasks            list of independent tasks to run each tick
 */
export function start(intervalMinutes: number, tasks: Task[]): void {
  if (timer) {
    console.warn("Scheduler already running; ignoring start()");
    return;
  }
  if (intervalMinutes <= 0) {
    console.warn(`Scheduler interval ${intervalMinutes} <= 0; not starting`);
    return;
  }

  currentInterval = intervalMinutes;
  const intervalMs = intervalMinutes * 60 * 1000;

  const tick = async () => {
    for (const task of tasks) {
      try {
        await task.run();
      } catch (err) {
        console.error(`[scheduler] task "${task.name}" failed:`, err);
      }
    }
  };

  // Fire immediately, then on interval.
  void tick();
  timer = setInterval(tick, intervalMs);
  console.log(`[scheduler] started (${intervalMinutes} min cadence, ${tasks.length} task${tasks.length === 1 ? "" : "s"})`);
}

export function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    currentInterval = null;
    console.log("[scheduler] stopped");
  }
}

export function isRunning(): boolean {
  return timer !== null;
}

export function getIntervalMinutes(): number | null {
  return currentInterval;
}
