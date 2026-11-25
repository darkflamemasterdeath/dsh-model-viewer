import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hidePreview,
  isHiddenPreview,
  readConfig,
  updateCacheConfig,
} from "./config.ts";
import { filesForTurn, restoreSession } from "./preview.ts";
import type {
  AttachmentReader,
  ConnectionFetch,
  OpenedFile,
  SessionLookup,
  StoredFile,
} from "./types.ts";

const occtDir = join(dirname(fileURLToPath(import.meta.url)), "..", "occt");
const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

// Static asset paths are fixed but contents change across plugin versions. Hash each file
// into an ETag and let the browser cache it: unchanged content answers 304 and the 7 MB
// WASM is not re-downloaded; changed content changes the ETag and the browser fetches fresh bytes.
const staticFiles: Record<
  string,
  { type: string; body: Buffer; etag: string }
> = {
  "occt.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(join(occtDir, "occt-import-js.js")),
    etag: "",
  },
  "occt.wasm": {
    type: "application/wasm",
    body: readFileSync(join(occtDir, "occt-import-js.wasm")),
    etag: "",
  },
  "worker.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(join(occtDir, "worker.js")),
    etag: "",
  },
  "loading.webp": {
    type: "image/webp",
    body: readFileSync(join(assetsDir, "loading", "loading.webp")),
    etag: "",
  },
  "scene-worker.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(join(dirname(fileURLToPath(import.meta.url)), "scene-worker.js")),
    etag: "",
  },
};

for (const file of Object.values(staticFiles)) {
  file.etag = `W/"${createHash("sha256").update(file.body).digest("hex").slice(0, 16)}"`;
}

async function readBytes(
  attachments: AttachmentReader,
  ref: StoredFile,
): Promise<Uint8Array<ArrayBuffer>> {
  const parts: Uint8Array[] = [];
  for await (const chunk of attachments.readFileStream(ref)) parts.push(chunk);
  const body = new Uint8Array(
    new ArrayBuffer(parts.reduce((sum, part) => sum + part.byteLength, 0)),
  );
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}

/** Byte size of a list entry: the registered size for attachments, stat on demand for disk files. */
function entryBytes(opened: OpenedFile): number {
  if (opened.attachment !== undefined) return opened.attachment.bytes;
  if (opened.diskPath !== undefined) {
    try {
      return statSync(opened.diskPath).size;
    } catch {
      // The disk file may be gone; show 0 on the card and only fail when actually read.
      return 0;
    }
  }
  return 0;
}

/**
 * Register routes for the parser assets and preview bytes.
 * @param ctx - Plugin context carrying the page connection and the attachment store.
 * @returns Disposers that un-register these routes when the plugin unloads.
 */
export function registerRoutes(ctx: {
  connection: { fetch: ConnectionFetch };
  attachments: AttachmentReader;
  sessions: SessionLookup;
}): Array<() => void> {
  const stops = Object.keys(staticFiles).map((name) =>
    ctx.connection.fetch.register({
      path: `/api/step-viewer/${name}`,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: (request) => {
        const file = staticFiles[name];
        const headers = {
          "content-type": file.type,
          etag: file.etag,
          "cache-control": "public, no-cache",
        };
        if (request.headers.get("if-none-match") === file.etag) {
          return Promise.resolve(new Response(null, { status: 304, headers }));
        }
        return Promise.resolve(
          new Response(new Uint8Array(file.body), { headers }),
        );
      },
    }),
  );
  stops.push(
    ctx.connection.fetch.register({
      path: "/api/step-viewer/preview",
      methods: ["GET"],
      requestBody: "buffered",
      fetch: async (request) => {
        const params = new URL(request.url, "http://localhost").searchParams;
        const sessionId = params.get("session") ?? "";
        restoreSession(sessionId, ctx.sessions.get(sessionId), ctx.attachments);
        const turn = params.get("turn") ?? "";
        const list = filesForTurn(sessionId, turn);
        const indexRaw = params.get("index");
        // Hidden previews are dropped from the list but keep their index, so hide keys stay stable.
        if (indexRaw === null) {
          return Response.json(
            list
              .map((file, index) => ({
                index,
                name: file.name,
                bytes: entryBytes(file),
              }))
              .filter(
                (entry) => !isHiddenPreview(sessionId, turn, entry.index),
              ),
          );
        }
        const index = Number(indexRaw);
        const opened = list[index];
        if (!Number.isInteger(index) || opened === undefined)
          return new Response("not found", { status: 404 });
        let body: Uint8Array<ArrayBuffer>;
        if (opened.diskPath !== undefined) {
          const bytes = readFileSync(opened.diskPath);
          body = new Uint8Array(new ArrayBuffer(bytes.byteLength));
          body.set(bytes);
        } else if (opened.attachment !== undefined) {
          body = await readBytes(ctx.attachments, opened.attachment);
        } else {
          return new Response("not found", { status: 404 });
        }
        return new Response(body, {
          headers: {
            "content-type": "application/octet-stream",
          },
        });
      },
    }),
  );
  stops.push(
    ctx.connection.fetch.register({
      path: "/api/step-viewer/config",
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        if (request.method === "GET") return Response.json(readConfig());
        return Response.json(updateCacheConfig(await request.json()));
      },
    }),
  );
  stops.push(
    ctx.connection.fetch.register({
      path: "/api/step-viewer/hide",
      methods: ["POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        const params = new URL(request.url, "http://localhost").searchParams;
        const index = Number(params.get("index"));
        if (!Number.isInteger(index))
          return new Response("bad request", { status: 400 });
        hidePreview(
          params.get("session") ?? "",
          params.get("turn") ?? "",
          index,
        );
        return Response.json({ ok: true });
      },
    }),
  );
  return stops;
}
