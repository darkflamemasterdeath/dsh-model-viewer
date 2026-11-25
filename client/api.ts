import type { ViewerConfig } from '../shared/config'
import { logPerf } from './perf'

/** One model pending preview in a turn: a light list entry without file bytes. */
export interface TurnFileEntry {
  index: number
  name: string
  bytes: number
}

/** Downloaded files are cached by session:turn:index, so a remount never re-downloads. */
const loadedFiles = new Map<string, File>()

function fileKey(sessionId: string, turn: number, index: number): string {
  return `${sessionId}:${turn}:${index}`
}

/** Read the persisted cache settings and hidden-preview list. */
export async function fetchViewerConfig(): Promise<ViewerConfig> {
  const response = await fetch('/api/step-viewer/config')
  if (!response.ok) throw new Error('配置读取失败')
  return await response.json() as ViewerConfig
}

/**
 * Persist new cache limits; they take effect after a restart.
 * @param patch - New cacheCount and cacheMinSizeMB values.
 * @returns The config as saved.
 */
export async function saveViewerConfig(patch: { cacheCount: number, cacheMinSizeMB: number }): Promise<ViewerConfig> {
  const response = await fetch('/api/step-viewer/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error('配置保存失败')
  return await response.json() as ViewerConfig
}

/**
 * Hide one preview for good and remember the choice on the service.
 * @param sessionId - Session id.
 * @param turn - Turn number.
 * @param index - Entry index within the turn.
 */
export async function hideTurnFile(sessionId: string, turn: number, index: number): Promise<void> {
  const params = new URLSearchParams({ session: sessionId, turn: String(turn), index: String(index) })
  const response = await fetch(`/api/step-viewer/hide?${params}`, { method: 'POST' })
  if (!response.ok) throw new Error('隐藏预览失败')
}

/**
 * Drop one downloaded file from the client cache, freeing its bytes.
 * @param sessionId - Session id.
 * @param turn - Turn number.
 * @param index - Entry index within the turn.
 */
export function dropTurnFile(sessionId: string, turn: number, index: number): void {
  loadedFiles.delete(fileKey(sessionId, turn, index))
}

/**
 * Check whether a model has been downloaded already, without triggering a download.
 * @param sessionId - Session id.
 * @param turn - Turn number.
 * @param index - Entry index within the turn.
 * @returns The downloaded file; empty when it was never downloaded.
 */
export function peekTurnFile(sessionId: string, turn: number, index: number): File | undefined {
  return loadedFiles.get(fileKey(sessionId, turn, index))
}

/**
 * List the models to preview in one turn. Names and sizes only; no bytes are downloaded.
 * @param sessionId - Session id.
 * @param turn - Turn number.
 * @returns The model list; an empty array when there is no preview.
 */
export async function listTurnFiles(sessionId: string, turn: number): Promise<TurnFileEntry[]> {
  const start = performance.now()
  const params = new URLSearchParams({ session: sessionId, turn: String(turn) })
  const response = await fetch(`/api/step-viewer/preview?${params}`)
  const entries = response.ok ? await response.json() as TurnFileEntry[] : []
  logPerf('list-turn-files', start)
  return entries
}

/**
 * Download one model file; a downloaded one is reused directly.
 * @param sessionId - Session id.
 * @param turn - Turn number.
 * @param entry - The entry in the list.
 * @returns The model file.
 */
export async function loadTurnFile(sessionId: string, turn: number, entry: TurnFileEntry): Promise<File> {
  const start = performance.now()
  const key = fileKey(sessionId, turn, entry.index)
  const cached = loadedFiles.get(key)
  if (cached !== undefined) {
    logPerf('download-model-file (cache hit)', start)
    return cached
  }
  const params = new URLSearchParams({
    session: sessionId,
    turn: String(turn),
    index: String(entry.index),
  })
  const response = await fetch(`/api/step-viewer/preview?${params}`)
  if (!response.ok) throw new Error('模型文件下载失败')
  const file = new File([await response.blob()], entry.name)
  loadedFiles.set(key, file)
  logPerf('download-model-file', start)
  return file
}
