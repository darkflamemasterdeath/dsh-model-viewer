import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from './define-tool'
import { openPreview, rememberUploads } from './files'
import { currentTurn, noteTurn, previewCall, rememberPreview } from './preview'
import { registerRoutes } from './routes'
import type { AttachmentReader, ConnectionFetch, SessionLookup } from './types'

/** Wait until the browser connection, tool registry, attachment store, and session store exist. */
export const inject = ['connection', 'tools', 'attachments', 'sessions']

/**
 * Record uploaded model files and serve a preview after the model calls `preview_step`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context & {
  connection: { fetch: ConnectionFetch }
  attachments: AttachmentReader
  sessions: SessionLookup
}): void {
  ctx.on('session/event', (session, event) => {
    noteTurn(session.id, event)
    rememberUploads(ctx.attachments, event)
    const preview = previewCall(event)
    if (preview === undefined) return
    const opened = openPreview(preview.path)
    if (opened !== undefined) rememberPreview(session.id, preview.turn, opened.file)
  })
  ctx.effect(() => {
    const stops = registerRoutes(ctx)
    const stopTool = ctx.tools.register(defineTool({
      name: 'preview_step',
      description: '在回复里预览一个 3D 模型（STEP/glTF/OBJ/STL/PLY/FBX）。用户要看几个文件就调用几次，每次只传一个 path。path 填文件说明里的只读路径，或用户在对话里写出的磁盘路径。',
      parameters: {
        path: { type: 'string', required: true, description: '只读副本路径，或用户给出的 .stp/.step 磁盘路径' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            attachmentId: { type: 'string', required: true },
            bytes: { type: 'number', required: true },
          },
        },
        presentationMeta: (_args, value) => value,
        render: (_args, value) => [{ type: 'text', text: value.name === '' ? '没有找到可预览的模型文件，不要再次调用。' : `已在回复中预览 ${value.name}` }],
      },
      async execute(args, exec) {
        const opened = openPreview(args.path)
        if (opened === undefined) return { name: '', attachmentId: '', bytes: 0 }
        const sessionId = exec.agent?.id
        const turn = sessionId === undefined ? undefined : currentTurn(sessionId)
        if (sessionId !== undefined && turn !== undefined) rememberPreview(sessionId, turn, opened.file)
        return { name: opened.file.name, attachmentId: opened.attachmentId, bytes: opened.bytes }
      },
    }))
    return () => {
      stopTool()
      for (const stop of stops) stop()
    }
  })
}
