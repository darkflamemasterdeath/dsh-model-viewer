/** Identifier of an uploaded attachment in the session. */
export interface StoredFile {
  attachmentId: string
  name: string
  bytes: number
}

/** One model to preview in a turn, from an attachment or a disk path. */
export interface OpenedFile {
  name: string
  attachment?: StoredFile
  diskPath?: string
}

/** Attachment-store methods the plugin uses. */
export interface AttachmentReader {
  fileHostPath(ref: StoredFile): string | undefined
  readFileStream(ref: StoredFile, signal?: AbortSignal): AsyncIterable<Uint8Array>
}

/** Page-request registration the plugin uses. */
export interface ConnectionFetch {
  register(route: {
    path: string
    methods: Array<'GET' | 'POST'>
    requestBody: 'buffered'
    fetch: (request: Request) => Promise<Response>
  }): () => void
}

/** One event in the session log. */
export interface LoggedEvent {
  type: string
  data: object
}

/** Look up a session already loaded into memory by id. */
export interface SessionLookup {
  get(id: string): { snapshotEvents(): readonly LoggedEvent[] } | undefined
}
