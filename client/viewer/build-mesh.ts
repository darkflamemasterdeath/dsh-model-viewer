import * as THREE from 'three'
import type { StepMesh } from './types'

/**
 * Turn one parsed STEP mesh into a Three.js mesh and optional face edges.
 * @param geometryMesh - mesh from the STEP parser.
 * @param showEdges - draw a line along each face boundary.
 * @returns the shaded mesh and, when requested, its edge lines.
 */
export function buildMesh(geometryMesh: StepMesh, showEdges: boolean): { mesh: THREE.Mesh, edges: THREE.Group | null } {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(geometryMesh.attributes.position.array, 3),
  )
  if (geometryMesh.attributes.normal) {
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(geometryMesh.attributes.normal.array, 3),
    )
  }
  geometry.name = geometryMesh.name
  const index = Uint32Array.from(geometryMesh.index.array)
  geometry.setIndex(new THREE.BufferAttribute(index, 1))

  const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 })
  const defaultMaterial = new THREE.MeshPhongMaterial({
    color: geometryMesh.color
      ? new THREE.Color(geometryMesh.color[0], geometryMesh.color[1], geometryMesh.color[2])
      : 0xcccccc,
    specular: 0,
  })
  const materials = [defaultMaterial]
  const edges = showEdges ? new THREE.Group() : null
  const faces = geometryMesh.brep_faces ?? []
  if (faces.length > 0) {
    for (const faceColor of faces) {
      const color = faceColor.color
        ? new THREE.Color(faceColor.color[0], faceColor.color[1], faceColor.color[2])
        : defaultMaterial.color
      materials.push(new THREE.MeshPhongMaterial({ color, specular: 0 }))
    }
    const triangleCount = geometryMesh.index.array.length / 3
    let triangleIndex = 0
    let faceColorGroupIndex = 0
    while (triangleIndex < triangleCount) {
      const firstIndex = triangleIndex
      let lastIndex: number
      let materialIndex: number
      if (faceColorGroupIndex >= faces.length) {
        lastIndex = triangleCount
        materialIndex = 0
      } else if (triangleIndex < faces[faceColorGroupIndex].first) {
        lastIndex = faces[faceColorGroupIndex].first
        materialIndex = 0
      } else {
        lastIndex = faces[faceColorGroupIndex].last + 1
        materialIndex = faceColorGroupIndex + 1
        faceColorGroupIndex++
      }
      geometry.addGroup(firstIndex * 3, (lastIndex - firstIndex) * 3, materialIndex)
      triangleIndex = lastIndex
      if (edges) {
        const innerGeometry = new THREE.BufferGeometry()
        innerGeometry.setAttribute('position', geometry.attributes.position)
        if (geometryMesh.attributes.normal) {
          innerGeometry.setAttribute('normal', geometry.attributes.normal)
        }
        innerGeometry.setIndex(new THREE.BufferAttribute(index.slice(firstIndex * 3, lastIndex * 3), 1))
        edges.add(new THREE.LineSegments(new THREE.EdgesGeometry(innerGeometry, 180), outlineMaterial))
      }
    }
  }

  const mesh = new THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0])
  mesh.name = geometryMesh.name
  if (edges) edges.renderOrder = mesh.renderOrder + 1
  return { mesh, edges }
}
