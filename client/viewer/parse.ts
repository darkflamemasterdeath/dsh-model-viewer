import { logPerf } from '../perf'
import type { SceneMesh, StepMesh } from './types'

/** The reply envelope both parse workers use. */
interface WorkerReply<T> {
  id: number
  data?: { meshes?: T[] }
  error?: string
}

/** One in-flight call: settling callbacks keyed by request id. */
interface Pending<T> {
  resolve: (meshes: T[]) => void
  reject: (error: Error) => void
}

/**
 * Create the caller for one resident worker.
 * @param url - The worker script path, resolved against the page origin.
 * @returns A function posting one request and settling with its mesh list.
 */
function createWorkerClient<T>(url: string) {
  let worker: Worker | null = null
  let nextRequestId = 0
  const waiting = new Map<number, Pending<T>>()

  /** Get the resident worker, creating it on first use. */
  function resident(): Worker {
    if (worker !== null) return worker
    const created = new Worker(new URL(url, window.location.origin), { type: 'module' })
    created.onmessage = (message: MessageEvent<WorkerReply<T>>) => {
      const entry = waiting.get(message.data.id)
      if (entry === undefined) return
      waiting.delete(message.data.id)
      if (message.data.error !== undefined) {
        entry.reject(new Error(message.data.error))
        return
      }
      entry.resolve(message.data.data?.meshes ?? [])
    }
    worker = created
    return worker
  }

  return (payload: Record<string, unknown>, transfer: Transferable[]): Promise<T[]> =>
    new Promise((resolve, reject) => {
      const id = nextRequestId++
      const start = performance.now()
      waiting.set(id, {
        resolve: meshes => {
          // The gap minus the worker's own parse time is clone/deserialize cost.
          logPerf(`${url.split('/').pop()} roundtrip (parse + clone)`, start)
          resolve(meshes)
        },
        reject,
      })
      try {
        // The second postMessage argument is the transfer list: the buffers move
        // to the worker without a copy and are detached locally, so this runs last.
        resident().postMessage({ id, ...payload }, transfer)
      } catch (error) {
        waiting.delete(id)
        reject(error instanceof Error ? error : new Error('解析请求失败'))
      }
    })
}

const stepCall = createWorkerClient<StepMesh>('/api/step-viewer/worker.js')
const sceneCall = createWorkerClient<SceneMesh>('/api/step-viewer/scene-worker.js')

/**
 * Tessellate STEP bytes through the resident OCCT worker. Caching is the caller's job.
 * @param buffer - The STEP file bytes.
 * @returns The mesh list; empty when the file has no mesh.
 */
export function tessellateStep(buffer: ArrayBuffer): Promise<StepMesh[]> {
  return stepCall({ buffer }, [buffer])
}

/**
 * Parse a non-STEP model through the resident scene worker, off the main thread.
 * The bytes are transferred, so a failure leaves them detached; the caller's
 * fallback path re-reads the file.
 * @param name - The file name; its extension selects the loader.
 * @param buffer - The model file bytes.
 * @returns The flattened scene meshes, ready for rebuildSceneObject.
 */
export function parseSceneModel(name: string, buffer: ArrayBuffer): Promise<SceneMesh[]> {
  return sceneCall({ name, buffer }, [buffer])
}
