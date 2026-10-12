/** App URLs, in one place. */
export const folderPath = (spaceId: string, folderId: string | null): string =>
  folderId ? `/f/${spaceId}/${folderId}` : `/f/${spaceId}`

export const notePath = (noteId: string): string => `/n/${noteId}`

export const tagPath = (tag: string): string => `/tags/${encodeURIComponent(tag)}`

export const filePath = (fileId: string): string => `/file/${fileId}`

export const sharePath = (spaceId: string): string => `/f/${spaceId}/share`

/** A share link inside the app (the token never stays in the history, see JoinPage). */
export const joinPath = (token: string): string => `/s/${token}`
