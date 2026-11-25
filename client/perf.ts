import { isDev } from '../shared/debug'

/**
 * Console perf marker: prints how long one step took, in seconds.
 * Development builds only — a production build returns before formatting anything.
 * @param step - Step name shown in the log line.
 * @param sinceMs - performance.now() sampled before the step ran.
 * @param detail - Optional extra text appended after the duration.
 */
export function logPerf(step: string, sinceMs: number, detail = ''): void {
  if (!isDev) return
  const seconds = (performance.now() - sinceMs) / 1000
  console.log(`[perf] ${step} ${seconds.toFixed(3)}s${detail}`)
}
