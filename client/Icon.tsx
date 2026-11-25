/**
 * Sidebar entry icon: an isometric cube, the same mark as the preview card in
 * TurnPreview. Drawn as SVG so it scales to `size` and inherits the surrounding
 * text colour instead of relying on a font glyph.
 */
export function Icon({ size, active }: { size: number, active: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      opacity={active ? 1 : 0.45}
      aria-hidden="true"
    >
      <path d="M12 2.5l8.5 4.8v9.4L12 21.5 3.5 16.7V7.3z" />
      <path d="M12 2.5v19M3.5 7.3L12 12l8.5-4.7" />
    </svg>
  )
}
