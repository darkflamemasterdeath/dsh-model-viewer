import { occtimportjs } from './occt.js'

// Every occtimportjs() call recompiles and instantiates the 7 MB WASM.
// Keep the instance in a module-level Promise: init on the first message, share it for all
// later parses, kept alive by the resident worker instead of rebuilt per file.
let occtReady = null

function logPerf(step, startMs) {
  console.log(`[perf] ${step} ${((performance.now() - startMs) / 1000).toFixed(3)}s`)
}

function loadOcct() {
  if (occtReady === null) {
    const initStart = performance.now()
    occtReady = occtimportjs({
      locateFile: () => new URL('./occt.wasm', self.location.href).href,
    }).then(module => {
      logPerf('occt-wasm-init (worker, once)', initStart)
      return module
    }).catch(error => {
      // On init failure drop the handle so the next message can retry instead of caching a broken Promise.
      occtReady = null
      throw error
    })
  }
  return occtReady
}

// Protocol: receives { id, buffer } (file bytes), replies { id, data } or { id, error }.
// The id matches a reply to its request; buffer holds bytes transferred from the main thread.
self.onmessage = async event => {
  const { id, buffer } = event.data
  try {
    const occt = await loadOcct()
    const tessellateStart = performance.now()
    const result = occt.ReadStepFile(new Uint8Array(buffer), null)
    logPerf('step-tessellate (worker)', tessellateStart)
    self.postMessage({ id, data: result })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : '解析失败' })
  }
}
