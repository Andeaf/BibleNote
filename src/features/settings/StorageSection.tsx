import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { t } from '@/i18n/ro'
import { CACHE_LIMIT_BYTES, blobUsage, clearCache } from '@/lib/blobs'
import { formatBytes } from '@/lib/files'
import { useSyncRuntime, useSyncState } from '@/sync/SyncContext'

/** The free plan's Storage quota, shared by the whole project. */
const QUOTA_BYTES = 1024 * 1024 * 1024

function Meter({ used, total, label }: { used: number; total: number; label: string }) {
  const percent = Math.min(100, Math.round((used / total) * 100))
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={used}
      className="mt-2 h-2 overflow-hidden rounded-full bg-canvas"
    >
      <div
        className={`h-full rounded-full ${percent >= 90 ? 'bg-danger' : 'bg-accent'}`}
        style={{ width: `${Math.max(percent, used > 0 ? 2 : 0)}%` }}
      />
    </div>
  )
}

/** "spațiu folosit / 1 GB" on the server, and the files kept on this device. */
export function StorageSection() {
  const { db, storage } = useSyncRuntime()
  const { online, lastPullAt } = useSyncState()
  const [server, setServer] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const local = useLiveQuery(() => blobUsage(db), [db])

  useEffect(() => {
    if (!online) return
    let current = true
    storage
      .usage()
      .then((bytes) => {
        if (current) setServer(bytes)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
    // Refreshed after every pull, so new uploads show up.
  }, [storage, online, lastPullAt])

  return (
    <>
      <h2 className="mt-6 mb-2 text-sm font-medium text-muted">{t.storage.title}</h2>
      <div className="divide-y divide-line rounded-xl border border-line bg-surface">
        <div className="px-4 py-3">
          <p className="text-sm font-medium">{t.storage.server}</p>
          {server === null ? (
            <p className="text-sm text-muted">
              {online ? t.common.loading : t.storage.serverUnavailable}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">
                {t.storage.serverUsed(formatBytes(server), formatBytes(QUOTA_BYTES))}
              </p>
              <Meter used={server} total={QUOTA_BYTES} label={t.storage.server} />
            </>
          )}
        </div>
        <div className="px-4 py-3">
          <p className="text-sm font-medium">{t.storage.device}</p>
          <p className="text-sm text-muted">
            {t.storage.deviceUsed(
              formatBytes(local?.cachedBytes ?? 0),
              formatBytes(CACHE_LIMIT_BYTES),
            )}
          </p>
          <Meter
            used={local?.cachedBytes ?? 0}
            total={CACHE_LIMIT_BYTES}
            label={t.storage.device}
          />
          {local && local.pendingCount > 0 && (
            <p className="mt-2 text-sm text-muted">
              {t.storage.pending(local.pendingCount, formatBytes(local.pendingBytes))}
            </p>
          )}
          <button
            type="button"
            className="btn btn-secondary mt-3"
            onClick={() => setConfirmClear(true)}
            disabled={!local || local.cachedBytes === 0}
          >
            {t.storage.clearCache}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmClear}
        title={t.storage.clearCacheTitle}
        message={t.storage.clearCacheHint}
        confirmLabel={t.storage.clearCache}
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          await clearCache(db)
          setConfirmClear(false)
        }}
      />
    </>
  )
}
