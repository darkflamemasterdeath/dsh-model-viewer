import type { Context } from '@deepseek-ai/cordis'
import { fetchViewerConfig } from './api'
import { Icon } from './Icon'
import { TurnPreview } from './TurnPreview'
import { applyCacheConfig } from './viewer/load-model'
import { Viewer } from './viewer/Viewer'

/** Services required before the sidebar entry can register. */
export const inject = ['slots']

interface SlotRegistry {
  inject(name: string, install: () => void): void
  register(
    options: { name?: string, id?: string, key?: string, order?: number, label?: string },
    component: typeof Icon | typeof Viewer | typeof TurnPreview,
  ): void
}

/**
 * Register the model viewer in the sidebar and under an assistant reply that asked for a preview.
 * @param ctx - client context. `slots` is provided by the web client.
 */
export function apply(ctx: Context & { slots: SlotRegistry }): void {
  const id = 'dsh-model-viewer'
  // Cache limits live in ~/.dsh/step-viewer/config.json; fetch them before any model loads.
  void fetchViewerConfig().then(applyCacheConfig).catch(() => undefined)
  ctx.slots.inject('sidebar.panellist', () => {
    ctx.slots.register({
      name: 'sidebar.panellist',
      id,
      order: 50,
      label: '模型预览',
    }, Icon)
  })
  ctx.slots.inject('main', () => {
    ctx.slots.register({
      name: 'main',
      key: id,
    }, Viewer)
  })
  ctx.slots.inject('conversation.chat.turnTail', () => {
    ctx.slots.register({
      name: 'conversation.chat.turnTail',
      id: 'step-preview',
      order: 10,
    }, TurnPreview)
  })
}
