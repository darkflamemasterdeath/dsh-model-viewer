import * as THREE from 'three'

/**
 * Idle renderers kept alive across mounts. A live WebGL context still holds the
 * uploaded buffers of shared geometry, so a remount renders without re-upload
 * or shader recompile. LIFO: the most recently released renderer is reused first.
 */
const idle: THREE.WebGLRenderer[] = []

/** How many idle renderers stay alive; older ones are disposed to respect browser context limits. */
const maxIdleRenderers = 3

/**
 * Borrow a WebGL renderer, reusing an idle one when possible.
 * @returns A renderer whose canvas the caller must attach to its stage.
 */
export function acquireRenderer(): THREE.WebGLRenderer {
  return idle.pop() ?? new THREE.WebGLRenderer({ antialias: true })
}

/**
 * Return a renderer to the pool instead of disposing it, so its GL state survives.
 * @param renderer - The renderer the caller is done with.
 */
export function releaseRenderer(renderer: THREE.WebGLRenderer): void {
  idle.push(renderer)
  while (idle.length > maxIdleRenderers) {
    const oldest = idle.shift()
    if (oldest === undefined) break
    oldest.dispose()
  }
}
