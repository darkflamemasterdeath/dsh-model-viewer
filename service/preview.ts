import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { openPreview, pathKey, rememberUploads } from './files.ts'
import type { AttachmentReader, LoggedEvent, OpenedFile, StoredFile } from './types.ts'

const previewFile = join(homedir(), '.dsh', 'step-viewer', 'previews.json')

function isStoredFile(value: object): value is StoredFile {
  return 'attachmentId' in value && typeof value.attachmentId === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'bytes' in value && typeof value.bytes === 'number'
}

function isOpenedFile(value: unknown): value is OpenedFile {
  if (typeof value !== 'object' || value === null || !('name' in value) || typeof value.name !== 'string') return false
  if ('attachment' in value && (typeof value.attachment !== 'object' || value.attachment === null || !isStoredFile(value.attachment))) return false
  if ('diskPath' in value && value.diskPath !== undefined && typeof value.diskPath !== 'string') return false
  const attachment = 'attachment' in value ? value.attachment : undefined
  const diskPath = 'diskPath' in value ? value.diskPath : undefined
  return attachment !== undefined || typeof diskPath === 'string'
}

function loadPreviews(): Map<string, OpenedFile[]> {
  if (!existsSync(previewFile)) return new Map()
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(previewFile, 'utf8'))
  } catch (error) {
    void error
    return new Map()
  }
  if (typeof parsed !== 'object' || parsed === null) return new Map()
  const loaded = new Map<string, OpenedFile[]>()
  for (const [key, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue
    const files = value.filter(isOpenedFile)
    if (files.length > 0) loaded.set(key, files)
  }
  return loaded
}

function savePreviews(): void {
  mkdirSync(dirname(previewFile), { recursive: true })
  const entries: Record<string, OpenedFile[]> = {}
  for (const [key, files] of previewByTurn) entries[key] = files
  writeFileSync(previewFile, JSON.stringify(entries))
}

const previewByTurn = loadPreviews()
const turnBySession = new Map<string, number>()
const restored = new Set<string>()

function sameFile(left: OpenedFile, right: OpenedFile): boolean {
  if (left.diskPath !== undefined && right.diskPath !== undefined) return pathKey(left.diskPath) === pathKey(right.diskPath)
  if (left.attachment !== undefined && right.attachment !== undefined) {
    return left.attachment.attachmentId === right.attachment.attachmentId && left.attachment.name === right.attachment.name
  }
  return false
}

function argumentPath(value: unknown): string {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value
  if (typeof parsed === 'object' && parsed !== null && 'path' in parsed && typeof parsed.path === 'string') return parsed.path
  return ''
}

/**
 * Record the turn the session is currently on.
 * @param sessionId - Session id.
 * @param event - One session event.
 */
export function noteTurn(sessionId: string, event: LoggedEvent): void {
  if ('turn' in event.data && typeof event.data.turn === 'number') turnBySession.set(sessionId, event.data.turn)
}

/**
 * The session's current turn.
 * @param sessionId - Session id.
 * @returns The turn of the latest turn-bearing event; empty when there is none yet.
 */
export function currentTurn(sessionId: string): number | undefined {
  return turnBySession.get(sessionId)
}

/**
 * Pull the preview path out of a tool-call event.
 * @param event - One session event.
 * @returns `preview_step` call, as turn and path; empty when it is not that call.
 */
export function previewCall(event: LoggedEvent): { turn: number, path: string } | undefined {
  if (event.type !== 'tool/call' || !('name' in event.data) || event.data.name !== 'preview_step') return undefined
  if (!('turn' in event.data) || typeof event.data.turn !== 'number') return undefined
  if (!('arguments' in event.data)) return undefined
  let path = ''
  try {
    path = argumentPath(event.data.arguments)
  } catch (error) {
    void error
    return undefined
  }
  if (path === '') return undefined
  return { turn: event.data.turn, path }
}

/**
 * Append a model to a turn's preview list. The same file is not appended twice.
 * @param sessionId - Session id.
 * @param turn - Turn number.
 * @param file - The model to display.
 */
export function rememberPreview(sessionId: string, turn: number, file: OpenedFile): void {
  const key = `${sessionId}:${turn}`
  const list = previewByTurn.get(key) ?? []
  if (list.some(item => sameFile(item, file))) return
  previewByTurn.set(key, [...list, file])
  savePreviews()
}

/**
 * Models already recorded for one turn.
 * @param sessionId - Session id; queried as an empty string when absent from the URL, which yields an empty list.
 * @param turn - Turn in text form, matching the URL parameter.
 * @returns The turn's models, in call order.
 */
/**
 * Replay the session log to restore previews from before a restart. Each session is scanned once.
 * @param sessionId - Session id.
 * @param session - The loaded session; skipped when it is not loaded yet.
 * @param attachments - Attachment store, used to map uploads back to paths.
 */
export function restoreSession(
  sessionId: string,
  session: { snapshotEvents(): readonly LoggedEvent[] } | undefined,
  attachments: AttachmentReader,
): void {
  if (sessionId === '' || session === undefined || restored.has(sessionId)) return
  restored.add(sessionId)
  for (const event of session.snapshotEvents()) {
    noteTurn(sessionId, event)
    rememberUploads(attachments, event)
    const preview = previewCall(event)
    if (preview === undefined) continue
    const opened = openPreview(preview.path)
    if (opened !== undefined) rememberPreview(sessionId, preview.turn, opened.file)
  }
}

export function filesForTurn(sessionId: string, turn: string): OpenedFile[] {
  return previewByTurn.get(`${sessionId}:${turn}`) ?? []
}
