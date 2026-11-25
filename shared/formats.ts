/** Model extensions (lowercase, with dot): STEP goes through OCCT, the rest use the three.js built-in loaders. */
export const modelExtensions = [
  ".stp",
  ".step",
  ".glb",
  ".gltf",
  ".obj",
  ".stl",
  ".ply",
  ".fbx",
] as const;
/** Whether the name is a supported model file, judged by extension. */
export function isModelName(name: string): boolean {
  const lower = name.toLowerCase();
  return modelExtensions.some((ext) => lower.endsWith(ext));
}
