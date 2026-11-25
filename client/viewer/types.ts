/** One mesh returned by the STEP parser. */
export interface StepMesh {
  name: string
  attributes: {
    position: { array: ArrayLike<number> }
    normal?: { array: ArrayLike<number> }
  }
  index: { array: ArrayLike<number> }
  color?: [number, number, number]
  brep_faces?: Array<{
    first: number
    last: number
    color?: [number, number, number] | null
  }>
}

/** One rebuilt material of a scene mesh: enough to reproduce the preview look. */
export interface SceneMaterial {
  /** Base color as a hex number. */
  color: number
  /** Emissive color as a hex number; absent means black. */
  emissive?: number
  /** Specular for Phong rebuilds; present only on materials that declare it. */
  specular?: number
  /** Metalness for PBR rebuilds; presence switches the rebuild to Standard. */
  metalness?: number
  /** Roughness for PBR rebuilds; presence switches the rebuild to Standard. */
  roughness?: number
  opacity: number
  transparent: boolean
  vertexColors: boolean
  flatShading: boolean
  /** three.js material side constant. */
  side: number
  /** Color map image; transferred as an ImageBitmap when the worker extracted one. */
  map?: ImageBitmap
  mapWrapS?: number
  mapWrapT?: number
  mapFlipY?: boolean
  mapColorSpace?: string
}

/** One drawable of a parsed scene, flattened with its world transform for transfer. */
export interface SceneMesh {
  /** 'mesh' rebuilds as a Mesh, 'lines' as LineSegments. */
  kind: 'mesh' | 'lines'
  name: string
  /** World matrix: 16 numbers, column-major like three's Matrix4.toArray. */
  matrix: number[]
  position: Float32Array
  normal?: Float32Array
  uv?: Float32Array
  color?: Float32Array
  /** Component count of `color`; defaults to 3. */
  colorSize?: number
  index?: Uint32Array
  /** Multi-material groups; absent means one material covers the whole mesh. */
  groups?: Array<{ start: number, count: number, materialIndex: number }>
  materials: SceneMaterial[]
}
