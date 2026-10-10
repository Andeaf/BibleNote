/** App URLs, in one place. */
export const folderPath = (spaceId: string, folderId: string | null): string =>
  folderId ? `/f/${spaceId}/${folderId}` : `/f/${spaceId}`

export const notePath = (noteId: string): string => `/n/${noteId}`

export const tagPath = (tag: string): string => `/tags/${encodeURIComponent(tag)}`
