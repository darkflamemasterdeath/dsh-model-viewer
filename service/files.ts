import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { isModelName } from "../shared/formats.ts";
import type {
  AttachmentReader,
  LoggedEvent,
  OpenedFile,
  StoredFile,
} from "./types.ts";

const uploadedByPath = new Map<string, StoredFile>();

function pathVariants(path: string): string[] {
  const plain = path.trim().replace(/^['"]+|['"]+$/g, "");
  if (!plain.includes("\\\\")) return [plain];
  return [plain, plain.replaceAll("\\\\", "\\")];
}

export function pathKey(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}

function filesIn(event: LoggedEvent): StoredFile[] {
  if (
    event.type !== "user/message" ||
    !("content" in event.data) ||
    !Array.isArray(event.data.content)
  )
    return [];
  const found: StoredFile[] = [];
  for (const block of event.data.content) {
    if (
      typeof block !== "object" ||
      block === null ||
      !("type" in block) ||
      block.type !== "file"
    )
      continue;
    if (
      !("attachment" in block) ||
      typeof block.attachment !== "object" ||
      block.attachment === null
    )
      continue;
    const attachment = block.attachment;
    if (!("name" in attachment) || typeof attachment.name !== "string")
      continue;
    if (
      !("attachmentId" in attachment) ||
      typeof attachment.attachmentId !== "string"
    )
      continue;
    if (!("bytes" in attachment) || typeof attachment.bytes !== "number")
      continue;
    found.push({
      attachmentId: attachment.attachmentId,
      name: attachment.name,
      bytes: attachment.bytes,
    });
  }
  return found;
}

export function rememberUploads(
  attachments: AttachmentReader,
  event: LoggedEvent,
): void {
  for (const ref of filesIn(event)) {
    let path: string | undefined;
    try {
      path = attachments.fileHostPath(ref);
    } catch (error) {
      void error;
      path = undefined;
    }
    if (path !== undefined) uploadedByPath.set(pathKey(path), ref);
  }
}

function lookupFile(path: string): StoredFile | undefined {
  for (const variant of pathVariants(path)) {
    const direct = uploadedByPath.get(pathKey(variant));
    if (direct !== undefined) return direct;
  }
  const named = [...uploadedByPath.values()].filter((ref) => {
    const name = ref.name.toLowerCase();
    return pathVariants(path).some(
      (variant) =>
        name === variant.trim().toLowerCase() ||
        pathKey(variant).endsWith(`/${name}`),
    );
  });
  return named.length === 1 ? named[0] : undefined;
}

function diskStep(
  path: string,
): { name: string; path: string; bytes: number } | undefined {
  for (const variant of pathVariants(path)) {
    if (variant === "") continue;
    const full = isAbsolute(variant) ? variant : resolve(variant);
    if (!existsSync(full)) continue;
    const info = statSync(full);
    if (!info.isFile() || !isModelName(basename(full))) continue;
    return { name: basename(full), path: full, bytes: info.size };
  }
  return undefined;
}

export function openPreview(
  path: string,
): { file: OpenedFile; attachmentId: string; bytes: number } | undefined {
  const ref = lookupFile(path);
  if (ref !== undefined && isModelName(ref.name)) {
    return {
      file: { name: ref.name, attachment: ref },
      attachmentId: ref.attachmentId,
      bytes: ref.bytes,
    };
  }
  const disk = diskStep(path);
  if (disk === undefined) return undefined;
  return {
    file: { name: disk.name, diskPath: disk.path },
    attachmentId: "sha256:disk",
    bytes: disk.bytes,
  };
}
