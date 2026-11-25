import type { CSSProperties } from "react";

const overlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  borderRadius: "var(--dsw-radius-lg)",
  pointerEvents: "none",
  background: "rgba(0, 0, 0, 0.5)",
};

const art: CSSProperties = {
  width: "min(300px, 66%)",
  height: "auto",
  borderRadius: 12,
};

const caption: CSSProperties = {
  margin: 0,
  color: "#ffffff",
  font: "500 14px/22px inherit",
};

/**
 * Loading art shown while parsing: an animated image with "Loading" text on a translucent black backdrop.
 * The image is served through the plugin's own `/api/step-viewer/` route: the host
 * package-asset route (`/plugins/<id>/assets/...`) is missing from the older loader
 * bundled with the desktop app, while the plugin's routes work on every surface.
 */
export function LoadingAnime({ label = "Loading..." }: { label?: string }) {
  return (
    <div style={overlay} role="status" aria-label={label}>
      <img
        style={art}
        src="/api/step-viewer/loading.webp"
        alt=""
      />
      <p style={caption}>{label}</p>
    </div>
  );
}
