/**
 * Whether this build should emit development-only diagnostics (perf markers,
 * trace points). Both faces read the same flag: `npm run dev` bakes `'development'`
 * and `npm run build` bakes `'production'` into `process.env.NODE_ENV`, which is
 * what lets the browser face — which has no `process` at runtime — answer this.
 *
 * Gate instrumentation with `if (!isDev) return` so a production build stays silent.
 */
export const isDev: boolean = process.env.NODE_ENV !== 'production'
