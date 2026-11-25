/** Persisted viewer settings, stored in `~/.dsh/step-viewer/config.json`. */
export interface ViewerConfig {
  /** How many built models the cache keeps at most; the least recently used is dropped first. */
  cacheCount: number
  /** Only files larger than this many megabytes are cached; smaller ones rebuild cheaply every time. */
  cacheMinSizeMB: number
  /** Previews the user hid for good, as `session:turn:index` keys; hidden previews are not listed. */
  hiddenPreviews: string[]
}

/** Settings in effect until the config file supplies its own values. */
export const defaultViewerConfig: ViewerConfig = {
  cacheCount: 4,
  cacheMinSizeMB: 25,
  hiddenPreviews: [],
}
