import { useSyncExternalStore } from 'react'
import { isModelName } from '../../shared/formats'
import { loadModelSource, type ModelSource } from './load-model'

export interface SidebarPreview {
  file: File
  status: string
  source: ModelSource | null
}

let sidebar: SidebarPreview | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): SidebarPreview | null {
  return sidebar
}

/** The model currently open in the sidebar; it stays after leaving the page. */
export function useSidebarPreview(): SidebarPreview | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * Open a model file in the sidebar and parse it in the background.
 * @param next - The file chosen by the user.
 */
export function openSidebarFile(next: File): void {
  if (!isModelName(next.name)) {
    sidebar = { file: next, status: '不支持这个格式', source: null }
    emit()
    return
  }
  sidebar = { file: next, status: '正在解析…', source: null }
  emit()
  void loadModelSource(next).then(source => {
    if (sidebar?.file !== next) return
    sidebar = { file: next, status: next.name, source }
    emit()
  }, (error: unknown) => {
    if (sidebar?.file !== next) return
    sidebar = { file: next, status: error instanceof Error ? error.message : '解析失败', source: null }
    emit()
  })
}
