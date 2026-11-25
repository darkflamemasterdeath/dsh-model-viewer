import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { defaultViewerConfig, type ViewerConfig } from '../shared/config.ts'

const configFile = join(homedir(), '.dsh', 'step-viewer', 'config.json')

function parseConfig(parsed: unknown): ViewerConfig {
  if (typeof parsed !== 'object' || parsed === null) return { ...defaultViewerConfig, hiddenPreviews: [] }
  const raw = parsed as Record<string, unknown>
  const cacheCount = typeof raw.cacheCount === 'number' && Number.isInteger(raw.cacheCount) && raw.cacheCount >= 0
    ? raw.cacheCount
    : defaultViewerConfig.cacheCount
  const cacheMinSizeMB = typeof raw.cacheMinSizeMB === 'number' && Number.isFinite(raw.cacheMinSizeMB) && raw.cacheMinSizeMB >= 0
    ? raw.cacheMinSizeMB
    : defaultViewerConfig.cacheMinSizeMB
  const hiddenPreviews = Array.isArray(raw.hiddenPreviews)
    ? raw.hiddenPreviews.filter((key): key is string => typeof key === 'string')
    : []
  return { cacheCount, cacheMinSizeMB, hiddenPreviews }
}

function loadConfig(): ViewerConfig {
  if (!existsSync(configFile)) return { ...defaultViewerConfig, hiddenPreviews: [] }
  try {
    return parseConfig(JSON.parse(readFileSync(configFile, 'utf8')))
  } catch (error) {
    void error
    console.warn('[step-viewer] config.json is not valid JSON; using defaults')
    return { ...defaultViewerConfig, hiddenPreviews: [] }
  }
}

function saveConfig(config: ViewerConfig): void {
  mkdirSync(dirname(configFile), { recursive: true })
  writeFileSync(configFile, JSON.stringify(config, null, 2))
}

// Write the defaults once so the user can find and edit the knobs in place.
if (!existsSync(configFile)) saveConfig({ ...defaultViewerConfig, hiddenPreviews: [] })

/**
 * The persisted viewer settings. Hand edits to config.json take effect on the next read.
 * @returns The current config.
 */
export function readConfig(): ViewerConfig {
  return loadConfig()
}

/**
 * The stable key of one preview entry inside a turn.
 * @param sessionId - Session id.
 * @param turn - Turn in text form, matching the URL parameter.
 * @param index - Entry index within the turn.
 * @returns `session:turn:index`.
 */
export function previewKey(sessionId: string, turn: string, index: number): string {
  return `${sessionId}:${turn}:${index}`
}

/**
 * Whether the user hid one preview for good.
 * @param sessionId - Session id.
 * @param turn - Turn in text form, matching the URL parameter.
 * @param index - Entry index within the turn.
 * @returns True when the preview must not be listed again.
 */
export function isHiddenPreview(sessionId: string, turn: string, index: number): boolean {
  return loadConfig().hiddenPreviews.includes(previewKey(sessionId, turn, index))
}

/**
 * Update the cache limits from the settings panel and persist them.
 * @param patch - Raw JSON fields; only valid numbers are applied.
 * @returns The config as saved.
 */
export function updateCacheConfig(patch: unknown): ViewerConfig {
  const config = loadConfig()
  if (typeof patch === 'object' && patch !== null) {
    const raw = patch as Record<string, unknown>
    if (typeof raw.cacheCount === 'number' && Number.isInteger(raw.cacheCount) && raw.cacheCount >= 0) {
      config.cacheCount = raw.cacheCount
    }
    if (typeof raw.cacheMinSizeMB === 'number' && Number.isFinite(raw.cacheMinSizeMB) && raw.cacheMinSizeMB >= 0) {
      config.cacheMinSizeMB = raw.cacheMinSizeMB
    }
  }
  saveConfig(config)
  return config
}

/**
 * Hide one preview for good and persist the choice across restarts.
 * The stored preview record stays, so removing the key from config.json brings the preview back.
 * @param sessionId - Session id.
 * @param turn - Turn in text form, matching the URL parameter.
 * @param index - Entry index within the turn.
 */
export function hidePreview(sessionId: string, turn: string, index: number): void {
  const config = loadConfig()
  const key = previewKey(sessionId, turn, index)
  if (config.hiddenPreviews.includes(key)) return
  saveConfig({ ...config, hiddenPreviews: [...config.hiddenPreviews, key] })
}
