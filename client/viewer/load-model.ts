import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { modelExtensions } from "../../shared/formats";
import { logPerf } from "../perf";
import { buildMesh } from "./build-mesh";
import { parseSceneModel, tessellateStep } from "./parse";
import { rebuildSceneObject } from "./scene-serial";
import type { StepMesh } from "./types";

export { modelExtensions };

/**
 * A parsed model's display master. buildDisplay clones it per scene, and the
 * clone shares read-only geometry with the master, so nothing is rebuilt.
 */
export interface ModelSource {
  master: THREE.Object3D;
}

/** Cache key -> build task. Map keeps insertion order; eviction deletes from the front. */
const masters = new Map<string, Promise<THREE.Object3D>>();

/** File -> cache key, so hiding a preview can find and drop its master. */
const keyByFile = new WeakMap<File, string>();

/** How many masters to keep; the least recently used is dropped first. */
let maxCachedModels = 4;

/** Files at or below this size are rebuilt on demand instead of cached. */
let minCacheFileBytes = 25 * 1024 * 1024;

/**
 * Apply the persisted cache settings.
 * @param options.cacheCount - How many masters to keep.
 * @param options.cacheMinSizeMB - Only files larger than this many megabytes are cached.
 */
export function applyCacheConfig(options: { cacheCount: number; cacheMinSizeMB: number }): void {
  maxCachedModels = options.cacheCount;
  minCacheFileBytes = options.cacheMinSizeMB * 1024 * 1024;
  trimToLimit();
}

function trimToLimit(): void {
  while (masters.size > maxCachedModels) {
    const oldest = masters.keys().next();
    if (oldest.done === true) break;
    dropMaster(oldest.value);
  }
}

function dropMaster(key: string): void {
  const evicted = masters.get(key);
  masters.delete(key);
  // The entry is a promise of the master; its resolution value is what gets released.
  // Releasing frees the shared GPU buffers in every context that uploaded them. A
  // clone still on screen re-uploads on its next frame, one stutter at worst.
  if (evicted !== undefined) {
    void evicted.then((master) => disposeMaster(master), () => undefined);
  }
}

/**
 * Drop one file's cached master and free its GPU buffers.
 * @param file - The file whose master is no longer wanted.
 */
export function dropModel(file: File): void {
  const key = keyByFile.get(file);
  if (key === undefined) return;
  keyByFile.delete(file);
  dropMaster(key);
}

function rememberMaster(key: string, master: Promise<THREE.Object3D>): void {
  masters.delete(key);
  masters.set(key, master);
  trimToLimit();
}

/** Free a master's geometry and materials so pooled renderers drop their GPU copies. */
function disposeMaster(master: THREE.Object3D): void {
  master.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  });
}

/**
 * Fingerprint the file content as a cache key.
 * Not the file name: same name may hide different content, and the same content under a new name should still hit.
 * @param file - The file to parse.
 * @param buffer - The file bytes.
 * @returns The content fingerprint.
 */
async function fileKey(file: File, buffer: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  // crypto.subtle exists only over https and localhost; fall back to name+size+mtime as the key.
  if (subtle === undefined) return `${file.name}:${file.size}:${file.lastModified}`;
  const digest = await subtle.digest("SHA-256", buffer);
  // The digest is 32 bytes; render each as two hex digits and join, e.g. 'a3f9...'.
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function meshesToGroup(meshes: StepMesh[]): THREE.Group {
  const start = performance.now();
  const group = new THREE.Group();
  for (const mesh of meshes) {
    const built = buildMesh(mesh, true);
    group.add(built.mesh);
    if (built.edges) group.add(built.edges);
  }
  logPerf("meshesToGroup (build loop)", start);
  return group;
}

/** Compute normals when a mesh lacks them, or lighting goes black. */
function ensureNormals(object: THREE.Object3D): THREE.Object3D {
  object.traverse((child) => {
    if (
      child instanceof THREE.Mesh &&
      child.geometry.getAttribute("normal") === undefined
    ) {
      child.geometry.computeVertexNormals();
    }
  });
  return object;
}

/** Wrap bare geometry (STL/PLY) into a mesh with a default material. */
function meshFromGeometry(geometry: THREE.BufferGeometry): THREE.Mesh {
  if (geometry.getAttribute("normal") === undefined)
    geometry.computeVertexNormals();
  const hasVertexColors = geometry.getAttribute("color") !== undefined;
  const material = new THREE.MeshPhongMaterial({
    color: hasVertexColors ? 0xffffff : 0xcccccc,
    specular: 0,
    vertexColors: hasVertexColors,
  });
  return new THREE.Mesh(geometry, material);
}

async function parseThreeModel(
  lower: string,
  file: File,
  buffer: ArrayBuffer,
): Promise<THREE.Object3D> {
  if (lower.endsWith(".glb"))
    return (await new GLTFLoader().parseAsync(buffer, "")).scene;
  if (lower.endsWith(".gltf"))
    return (await new GLTFLoader().parseAsync(await file.text(), "")).scene;
  if (lower.endsWith(".obj"))
    return ensureNormals(new OBJLoader().parse(await file.text()));
  if (lower.endsWith(".stl"))
    return meshFromGeometry(new STLLoader().parse(buffer));
  if (lower.endsWith(".ply"))
    return meshFromGeometry(new PLYLoader().parse(buffer));
  if (lower.endsWith(".fbx"))
    return ensureNormals(new FBXLoader().parse(buffer, ""));
  throw new Error("不支持的格式");
}

/** Build the display master once per content: tessellate + geometry for STEP, a loader result for the rest. */
async function buildMaster(file: File, buffer: ArrayBuffer): Promise<THREE.Object3D> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".stp") || lower.endsWith(".step")) {
    const meshes = await tessellateStep(buffer);
    if (meshes.length === 0) throw new Error("这个文件没有解析出网格");
    return meshesToGroup(meshes);
  }
  const parseStart = performance.now();
  // Non-STEP files parse off the main thread so the page stays clickable.
  try {
    const master = rebuildSceneObject(await parseSceneModel(file.name, buffer));
    logPerf("scene-worker (parse + rebuild)", parseStart);
    return master;
  } catch {
    // The worker request transferred and detached the bytes; the fallback
    // loaders below need them again, so re-read from the file.
    const retry = await file.arrayBuffer();
    const master = ensureNormals(await parseThreeModel(lower, file, retry));
    logPerf("three-loader-parse (fallback after worker failure)", parseStart);
    return master;
  }
}

/**
 * Parse a 3D model file into its display master; the same content is built only once.
 * @param file - A model file (STEP or a three.js built-in format).
 * @returns The cached master; buildDisplay clones it per scene.
 */
export async function loadModelSource(file: File): Promise<ModelSource> {
  const readStart = performance.now();
  const buffer = await file.arrayBuffer();
  logPerf("read-file-bytes", readStart);
  const hashStart = performance.now();
  const key = await fileKey(file, buffer);
  logPerf("content-hash", hashStart);
  keyByFile.set(file, key);
  const cached = masters.get(key);
  if (cached !== undefined) {
    // Delete-then-insert moves the entry to the tail, so the head is always the least recently used.
    masters.delete(key);
    masters.set(key, cached);
    return { master: await cached };
  }
  const task = buildMaster(file, buffer);
  // Small files rebuild cheaply, so only large ones earn a cache slot.
  if (file.size > minCacheFileBytes) rememberMaster(key, task);
  try {
    return { master: await task };
  } catch (error) {
    // A failed build is not cached, so a retry may parse again.
    if (masters.get(key) === task) masters.delete(key);
    throw error;
  }
}

/**
 * Build a scene-ready object from a parse result; each call returns a fresh one.
 * @param source - The value returned by loadModelSource.
 * @returns An Object3D dedicated to this display.
 */
export function buildDisplay(source: ModelSource): THREE.Object3D {
  const start = performance.now();
  // clone() copies the object tree but shares read-only geometry and materials.
  const clone = source.master.clone(true);
  logPerf("build-display (clone)", start);
  return clone;
}
