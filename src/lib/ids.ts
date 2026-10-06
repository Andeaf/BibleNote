/** Client-generated ids: rows are created offline and keep their id on the server. */
export const newId = (): string => crypto.randomUUID()

/** ISO timestamp for local rows; the server replaces it with its own clock on push. */
export const nowIso = (): string => new Date().toISOString()
