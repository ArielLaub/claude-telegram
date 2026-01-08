/**
 * Stats Collector - Collects CPU and memory samples for histograms
 */

import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface StatsSample {
  timestamp: number;
  cpuPercent: number;
  memPercent: number;
}

// Store 10 minutes of samples at 30-second intervals = 20 samples
const MAX_SAMPLES = 20;
const SAMPLE_INTERVAL_MS = 30 * 1000;

const samples: StatsSample[] = [];
let collectorInterval: NodeJS.Timeout | null = null;

/** Get current CPU usage percentage */
async function getCpuUsage(): Promise<number> {
  try {
    const { stdout } = await execAsync(
      "top -bn1 | grep 'Cpu(s)' | awk '{print $2}'"
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/** Get current memory usage percentage */
function getMemUsage(): number {
  const total = os.totalmem();
  const free = os.freemem();
  return ((total - free) / total) * 100;
}

/** Collect a single sample */
async function collectSample(): Promise<void> {
  const sample: StatsSample = {
    timestamp: Date.now(),
    cpuPercent: await getCpuUsage(),
    memPercent: getMemUsage(),
  };

  samples.push(sample);

  // Keep only last MAX_SAMPLES
  while (samples.length > MAX_SAMPLES) {
    samples.shift();
  }
}

/** Start the stats collector */
export function startCollector(): void {
  if (collectorInterval) return;

  // Collect immediately
  collectSample();

  // Then collect every SAMPLE_INTERVAL_MS
  collectorInterval = setInterval(collectSample, SAMPLE_INTERVAL_MS);
  console.log("Stats collector started (30s intervals, 10min history)");
}

/** Stop the stats collector */
export function stopCollector(): void {
  if (collectorInterval) {
    clearInterval(collectorInterval);
    collectorInterval = null;
  }
}

/** Get all samples */
export function getSamples(): StatsSample[] {
  return [...samples];
}

/** Build a text histogram from values */
export function buildHistogram(values: number[], width = 20, maxValue = 100): string {
  if (values.length === 0) return "No data";

  // Use block characters for different heights
  const blocks = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

  // Normalize and convert to block characters
  const histogram = values.map((v) => {
    const normalized = Math.min(v / maxValue, 1);
    const blockIndex = Math.round(normalized * (blocks.length - 1));
    return blocks[blockIndex];
  });

  // Pad or trim to width
  while (histogram.length < width) {
    histogram.unshift(" ");
  }
  if (histogram.length > width) {
    histogram.splice(0, histogram.length - width);
  }

  return histogram.join("");
}

/** Get histogram data for display */
export function getHistogramData(): { cpu: string; mem: string; sampleCount: number } {
  const cpuValues = samples.map((s) => s.cpuPercent);
  const memValues = samples.map((s) => s.memPercent);

  return {
    cpu: buildHistogram(cpuValues),
    mem: buildHistogram(memValues),
    sampleCount: samples.length,
  };
}
