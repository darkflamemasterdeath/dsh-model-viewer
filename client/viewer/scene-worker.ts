import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { extractSceneMeshes } from "./scene-serial";
import type { SceneMesh } from "./types";

/**
 * Parse worker for the non-STEP formats. A large STL/OBJ/GLTF blocks the page
 * for as long as its parse runs, so the loaders run here instead and only plain
 * typed arrays travel back (see scene-serial.ts).
 *
 * Same boot protocol as the OCCT worker: one `{ id, name, buffer }` request in,
 * one `{ id, data: { meshes } | error }` reply out, the file bytes transferred.
 */

// Workers have no `document`, and three's ImageLoader decodes images through an
// <img> element. Replace it with fetch + createImageBitmap so every loader keeps
// working here, texture maps included (the bitmap transfers back with the mesh).
THREE.ImageLoader.prototype.load = function load(
  url: string,
  onLoad?: (image: HTMLImageElement) => void,
  _onProgress?: (event: ProgressEvent) => void,
  onError?: (error: unknown) => void,
): HTMLImageElement {
  void fetch(url)
    .then((response) =>
      response.ok ? response.blob() : Promise.reject(new Error(`图片加载失败: ${response.status}`)),
    )
    .then((blob) => createImageBitmap(blob))
    .then(
      (bitmap) => onLoad?.(bitmap as unknown as HTMLImageElement),
      (error: unknown) => onError?.(error),
    );
  return null as unknown as HTMLImageElement;
};

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

/** Run the matching three.js loader, mirroring the main-thread dispatch. */
async function parseScene(name: string, buffer: ArrayBuffer): Promise<THREE.Object3D> {
  const lower = name.toLowerCase();
  const text = (): string => new TextDecoder().decode(buffer);
  if (lower.endsWith(".glb"))
    return (await new GLTFLoader().parseAsync(buffer, "")).scene;
  if (lower.endsWith(".gltf"))
    return (await new GLTFLoader().parseAsync(text(), "")).scene;
  if (lower.endsWith(".obj")) return ensureNormals(new OBJLoader().parse(text()));
  if (lower.endsWith(".stl")) return meshFromGeometry(new STLLoader().parse(buffer));
  if (lower.endsWith(".ply")) return meshFromGeometry(new PLYLoader().parse(buffer));
  if (lower.endsWith(".fbx")) return ensureNormals(new FBXLoader().parse(buffer, ""));
  throw new Error("scene worker 不支持的格式");
}

/** The page's request. */
interface SceneRequest {
  id: number;
  name: string;
  buffer: ArrayBuffer;
}

self.addEventListener("message", (message: MessageEvent<SceneRequest>) => {
  const { id, name, buffer } = message.data;
  void parseScene(name, buffer).then(
    (root) => {
      const { meshes, transfer } = extractSceneMeshes(root);
      const reply = { id, data: { meshes } as { meshes: SceneMesh[] } };
      (self as unknown as Worker).postMessage(reply, transfer);
    },
    (error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);
      (self as unknown as Worker).postMessage({ id, error: text });
    },
  );
});
