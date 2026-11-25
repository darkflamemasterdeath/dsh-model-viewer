import * as THREE from "three";
import type { SceneMaterial, SceneMesh } from "./types";

/**
 * Scene serialization between the parse worker and the page. A THREE.Object3D
 * cannot cross a worker boundary (methods and class instances are not cloneable),
 * so the worker flattens every drawable into plain typed arrays — which transfer
 * without copying — and the page rebuilds cheap objects from them.
 */

/** Read one attribute into a packed Float32Array; interleaved forms included. */
function readAttribute(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  itemSize: number,
): Float32Array {
  const out = new Float32Array(attribute.count * itemSize);
  for (let i = 0; i < attribute.count; i++) {
    const at = i * itemSize;
    out[at] = attribute.getX(i);
    if (itemSize > 1) out[at + 1] = attribute.getY(i);
    if (itemSize > 2) out[at + 2] = attribute.getZ(i);
    if (itemSize > 3) out[at + 3] = attribute.getW(i);
  }
  return out;
}

/** Flatten one material into the essentials a preview rebuild needs. */
function serializeMaterial(material: THREE.Material): SceneMaterial {
  const source = material as THREE.MeshStandardMaterial & THREE.MeshPhongMaterial;
  const out: SceneMaterial = {
    color: source.color?.getHex() ?? 0xcccccc,
    opacity: material.opacity,
    transparent: material.transparent,
    vertexColors: source.vertexColors ?? false,
    flatShading: source.flatShading ?? false,
    side: material.side,
  };
  const emissive = source.emissive?.getHex() ?? 0;
  if (emissive !== 0) out.emissive = emissive;
  if (source.specular !== undefined) out.specular = source.specular.getHex();
  if (source.metalness !== undefined) out.metalness = source.metalness;
  if (source.roughness !== undefined) out.roughness = source.roughness;
  const map = source.map;
  if (map !== null && map !== undefined && map.image instanceof ImageBitmap) {
    out.map = map.image;
    out.mapWrapS = map.wrapS;
    out.mapWrapT = map.wrapT;
    out.mapFlipY = map.flipY;
    out.mapColorSpace = map.colorSpace;
  }
  return out;
}

/**
 * Flatten a parsed scene into transferable mesh records.
 * @param root - The loader result, still a live three.js tree in the worker.
 * @returns The records plus every buffer worth transferring.
 */
export function extractSceneMeshes(root: THREE.Object3D): {
  meshes: SceneMesh[];
  transfer: Transferable[];
} {
  root.updateWorldMatrix(true, true);
  const meshes: SceneMesh[] = [];
  const transfer: Transferable[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments))
      return;
    const geometry = child.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute("position");
    if (position === undefined) return;
    const entry: SceneMesh = {
      kind: child instanceof THREE.LineSegments ? "lines" : "mesh",
      name: child.name,
      matrix: child.matrixWorld.toArray(),
      position: readAttribute(position, 3),
      materials: (Array.isArray(child.material) ? child.material : [child.material])
        .map(serializeMaterial),
    };
    transfer.push(entry.position.buffer as ArrayBuffer);
    const normal = geometry.getAttribute("normal");
    if (normal !== undefined) {
      entry.normal = readAttribute(normal, 3);
      transfer.push(entry.normal.buffer as ArrayBuffer);
    }
    const uv = geometry.getAttribute("uv");
    if (uv !== undefined) {
      entry.uv = readAttribute(uv, 2);
      transfer.push(entry.uv.buffer as ArrayBuffer);
    }
    const color = geometry.getAttribute("color");
    if (color !== undefined) {
      entry.color = readAttribute(color, color.itemSize);
      entry.colorSize = color.itemSize;
      transfer.push(entry.color.buffer as ArrayBuffer);
    }
    const index = geometry.getIndex();
    if (index !== null) {
      entry.index = Uint32Array.from(index.array as ArrayLike<number>);
      transfer.push(entry.index.buffer as ArrayBuffer);
    }
    if (Array.isArray(child.material) && child.material.length > 1) {
      entry.groups = geometry.groups.map((group) => ({
        start: group.start,
        count: group.count,
        materialIndex: group.materialIndex ?? 0,
      }));
    }
    for (const material of entry.materials) {
      if (material.map !== undefined) transfer.push(material.map);
    }
    meshes.push(entry);
  });
  return { meshes, transfer };
}

/** Rebuild one serialized material; Standard for PBR sources, Phong otherwise. */
function rebuildMaterial(spec: SceneMaterial): THREE.Material {
  let map: THREE.Texture | null = null;
  if (spec.map !== undefined) {
    map = new THREE.Texture(spec.map);
    map.wrapS = (spec.mapWrapS ?? THREE.RepeatWrapping) as THREE.Wrapping;
    map.wrapT = (spec.mapWrapT ?? THREE.RepeatWrapping) as THREE.Wrapping;
    map.flipY = spec.mapFlipY ?? true;
    if (spec.mapColorSpace !== undefined) map.colorSpace = spec.mapColorSpace;
    map.needsUpdate = true;
  }
  const shared = {
    color: spec.color,
    opacity: spec.opacity,
    transparent: spec.transparent,
    vertexColors: spec.vertexColors,
    flatShading: spec.flatShading,
    side: spec.side as THREE.Side,
    map,
  };
  if (spec.metalness !== undefined || spec.roughness !== undefined) {
    return new THREE.MeshStandardMaterial({
      ...shared,
      metalness: spec.metalness ?? 0,
      roughness: spec.roughness ?? 1,
      emissive: spec.emissive ?? 0x000000,
    });
  }
  return new THREE.MeshPhongMaterial({
    ...shared,
    specular: spec.specular ?? 0x111111,
    emissive: spec.emissive ?? 0x000000,
  });
}

/**
 * Rebuild a display tree from transferred mesh records.
 * @param meshes - Records produced by {@link extractSceneMeshes}.
 * @returns A fresh Object3D ready for the viewer; cheap on the main thread.
 */
export function rebuildSceneObject(meshes: SceneMesh[]): THREE.Object3D {
  const root = new THREE.Group();
  for (const entry of meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(entry.position, 3));
    if (entry.normal !== undefined) {
      geometry.setAttribute("normal", new THREE.BufferAttribute(entry.normal, 3));
    }
    if (entry.uv !== undefined) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(entry.uv, 2));
    }
    if (entry.color !== undefined) {
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(entry.color, entry.colorSize ?? 3),
      );
    }
    if (entry.index !== undefined) {
      geometry.setIndex(new THREE.BufferAttribute(entry.index, 1));
    }
    for (const group of entry.groups ?? []) {
      geometry.addGroup(group.start, group.count, group.materialIndex);
    }
    const materials = entry.materials.map((spec) =>
      entry.kind === "lines"
        ? new THREE.LineBasicMaterial({
            color: spec.color,
            opacity: spec.opacity,
            transparent: spec.transparent,
          })
        : rebuildMaterial(spec),
    );
    const object =
      entry.kind === "lines"
        ? new THREE.LineSegments(geometry, materials[0])
        : new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    object.name = entry.name;
    object.matrixAutoUpdate = false;
    object.matrix.fromArray(entry.matrix);
    root.add(object);
  }
  return root;
}
