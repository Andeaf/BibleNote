import { Copy, Link2Off, RefreshCw, Send, Share2, UserMinus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog } from '@/components/ui/Dialog'
import { useNow } from '@/features/notes/hooks'
import { useSpace } from '@/features/folders/hooks'
import { t } from '@/i18n/ro'
import type { ShareLinkRow, SpaceMemberRow } from '@/lib/database.types'
import { folderPath } from '@/lib/paths'
import { shareUrl } from '@/lib/shareLink'
import { formatRelative } from '@/lib/time'
import { shareApi } from '@/sync/shareApi'
import { useSyncRuntime, useSyncState } from '@/sync/SyncContext'

interface ShareData {
  links: ShareLinkRow[]
  members: SpaceMemberRow[]
}

/** Turning a link off or making a new one: both can also remove the people it let in. */
type LinkAction = { kind: 'off' | 'regenerate'; link: ShareLinkRow }

/**
 * "Partajare" for the owner of a main folder: the reading and the editing
 * link (copy, send, on/off, a new link), and the people with access, who can be removed.
 * Online only: links are not synced and every action is checked by the server.
 */
export function SharePage() {
  const { spaceId = '' } = useParams()
  const space = useSpace(spaceId)
  const { db, notify } = useSyncRuntime()
  const { online } = useSyncState()
  const now = useNow()
  const [data, setData] = useState<ShareData | null>(null)
  const [failed, setFailed] = useState(false)
  const [action, setAction] = useState<LinkAction | null>(null)
  const [removing, setRemoving] = useState<SpaceMemberRow | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((n) => n + 1), [])

  useEffect(() => {
    if (!online) return
    let current = true
    Promise.all([shareApi.links(spaceId), shareApi.members(spaceId)]).then(
      ([links, members]) => {
        if (!current) return
        setData({ links, members })
        setFailed(false)
      },
      () => {
        if (current) setFailed(true)
      },
    )
    return () => {
      current = false
    }
  }, [spaceId, online, version])

  if (space === undefined) return null
  if (!space || space.role !== 'owner') {
    return (
      <div className="px-4 py-10">
        <EmptyState icon={Share2} title={t.share.title} hint={t.folders.notFound} />
      </div>
    )
  }

  const fail = () =>
    notify({
      kind: 'message',
      text: navigator.onLine ? t.share.actionFailed : t.common.needsInternet,
    })

  async function setEnabled(link: ShareLinkRow, enabled: boolean, removeMembers: boolean) {
    try {
      await shareApi.setLinkEnabled(link.id, enabled, removeMembers)
      // Removed people stay in the local list of names until the next full pull: drop them now.
      if (removeMembers)
        await db.members
          .where('space_id')
          .equals(spaceId)
          .filter((m) => m.link_id === link.id)
          .delete()
    } catch {
      fail()
    }
    reload()
  }

  async function regenerate(link: ShareLinkRow, removeMembers: boolean) {
    try {
      await shareApi.regenerateLink(link.id, removeMembers)
      if (removeMembers)
        await db.members
          .where('space_id')
          .equals(spaceId)
          .filter((m) => m.link_id === link.id)
          .delete()
    } catch {
      fail()
    }
    reload()
  }

  async function remove(member: SpaceMemberRow) {
    try {
      await shareApi.removeMember(member.id)
      await db.members.delete(member.id)
    } catch {
      fail()
    }
    setRemoving(null)
    reload()
  }

  const byRole = (role: 'viewer' | 'editor') => data?.links.find((l) => l.role === role)
  const memberName = (m: SpaceMemberRow) => m.display_name?.trim() || t.share.unnamed

  return (
    <>
      <PageHeader title={t.share.title} backTo={folderPath(spaceId, null)} />
      <div className="mx-auto max-w-2xl px-4 py-4 lg:px-6">
        <p className="mb-4 text-sm text-muted">
          <Link to={folderPath(spaceId, null)} className="font-medium text-ink hover:underline">
            {space.name}
          </Link>
          {' · '}
          {t.share.intro}
        </p>

        {!online ? (
          <p role="status" className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
            {t.common.needsInternet}
          </p>
        ) : failed ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3">
            <p role="alert" className="text-sm text-danger">
              {t.share.loadFailed}
            </p>
            <button type="button" className="btn btn-secondary" onClick={reload}>
              {t.share.retry}
            </button>
          </div>
        ) : !data ? (
          <p role="status" className="text-sm text-muted">
            {t.common.loading}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3">
              {(['viewer', 'editor'] as const).map((role) => {
                const link = byRole(role)
                return link ? (
                  <LinkCard
                    key={link.id}
                    link={link}
                    spaceName={space.name}
                    onCopied={(ok) =>
                      notify({ kind: 'message', text: ok ? t.share.copied : t.share.copyFailed })
                    }
                    onTurnOn={() => void setEnabled(link, true, false)}
                    onAction={(kind) => setAction({ kind, link })}
                  />
                ) : null
              })}
            </div>

            <h2 className="mt-6 mb-2 text-sm font-medium text-muted">{t.share.people}</h2>
            <div className="rounded-xl border border-line bg-surface">
              {data.members.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted">{t.share.noPeople}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.members
                    .slice()
                    .sort((a, b) => memberName(a).localeCompare(memberName(b), 'ro'))
                    .map((member) => (
                      <li key={member.id} className="flex items-center gap-3 px-4 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{memberName(member)}</p>
                          <p className="text-xs text-muted">
                            {member.role === 'editor' ? t.share.roleEditor : t.share.roleViewer}
                            {member.last_seen_at &&
                              ` · ${t.share.lastSeen(
                                formatRelative(member.last_seen_at, now) ?? t.notes.justNow,
                              )}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary shrink-0 text-danger"
                          onClick={() => setRemoving(member)}
                          aria-label={`${t.share.remove}: ${memberName(member)}`}
                        >
                          <UserMinus className="size-4" aria-hidden="true" />
                          <span className="hidden sm:inline">{t.share.remove}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {action && (
        <LinkActionDialog
          action={action}
          onClose={() => setAction(null)}
          onConfirm={async (removeMembers) => {
            if (action.kind === 'off') await setEnabled(action.link, false, removeMembers)
            else await regenerate(action.link, removeMembers)
            setAction(null)
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t.share.removeTitle(removing ? memberName(removing) : '')}
        message={t.share.removeHint}
        confirmLabel={t.share.remove}
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => (removing ? remove(removing) : undefined)}
      />
    </>
  )
}

interface LinkCardProps {
  link: ShareLinkRow
  spaceName: string
  onCopied: (ok: boolean) => void
  onTurnOn: () => void
  onAction: (kind: 'off' | 'regenerate') => void
}

function LinkCard({ link, spaceName, onCopied, onTurnOn, onAction }: LinkCardProps) {
  const url = shareUrl(link.token)
  const editing = link.role === 'editor'
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      onCopied(true)
    } catch {
      onCopied(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">{editing ? t.share.editorLink : t.share.viewerLink}</h2>
          <p className="mt-0.5 text-sm text-muted">
            {editing ? t.share.editorHint : t.share.viewerHint}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            link.enabled ? 'bg-accent-soft text-accent' : 'bg-canvas text-muted'
          }`}
        >
          {link.enabled ? t.share.on : t.share.off}
        </span>
      </div>

      {link.enabled ? (
        <>
          <p className="mt-3 truncate rounded-lg bg-canvas px-3 py-2 font-mono text-xs select-all">
            {url}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => void copy()}>
              <Copy className="size-4" aria-hidden="true" />
              {t.share.copy}
            </button>
            {canShare && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  void navigator
                    .share({ title: spaceName, text: t.share.sendText(spaceName), url })
                    .catch(() => undefined)
                }
              >
                <Send className="size-4" aria-hidden="true" />
                {t.share.send}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => onAction('off')}>
              <Link2Off className="size-4" aria-hidden="true" />
              {t.share.turnOff}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onAction('regenerate')}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              {t.share.regenerate}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted">{t.share.offHint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={onTurnOn}>
              {t.share.turnOn}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onAction('regenerate')}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              {t.share.regenerate}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function LinkActionDialog({
  action,
  onClose,
  onConfirm,
}: {
  action: LinkAction
  onClose: () => void
  onConfirm: (removeMembers: boolean) => Promise<void>
}) {
  // Checked by default: a link turned off or replaced should also cut the access it gave.
  const [removeMembers, setRemoveMembers] = useState(true)
  const [busy, setBusy] = useState(false)
  const off = action.kind === 'off'

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={off ? t.share.turnOffTitle : t.share.regenerateTitle}
    >
      <p className="text-sm text-muted">{off ? t.share.turnOffHint : t.share.regenerateHint}</p>
      <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={removeMembers}
          onChange={(event) => setRemoveMembers(event.target.checked)}
          className="size-5 accent-accent"
        />
        {t.share.removeMembersOption}
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          {t.common.cancel}
        </button>
        <button
          type="button"
          className="btn bg-danger text-white hover:brightness-110"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onConfirm(removeMembers).finally(() => setBusy(false))
          }}
        >
          {off ? t.share.turnOff : t.share.regenerate}
        </button>
      </div>
    </Dialog>
  )
}
