import { Download, Share, Smartphone, X } from 'lucide-react'
import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { t } from '@/i18n/ro'
import { isIos, isStandalone, promptInstall, useCanInstall } from '@/lib/install'

const BANNER_KEY = 'bn-ios-install-banner'

/** Distribuie → Adaugă pe ecranul principal → Adaugă. */
export function IosInstallDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t.install.iosTitle}>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
        {t.install.iosSteps.map((step, index) => (
          <li key={index}>
            {step}
            {index === 0 && (
              <Share
                className="ml-1 inline size-4 align-text-bottom text-accent"
                aria-hidden="true"
              />
            )}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-muted">{t.install.iosNotSafari}</p>
      <p className="mt-2 text-sm text-muted">{t.install.iosAfter}</p>
      <div className="mt-5 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t.common.close}
        </button>
      </div>
    </Dialog>
  )
}

/** "Instalare" in Settings: the browser's own dialog where it exists, the steps on iPhone. */
export function InstallSection() {
  const canInstall = useCanInstall()
  const [standalone] = useState(isStandalone)
  const [ios] = useState(isIos)
  const [steps, setSteps] = useState(false)

  return (
    <>
      <h2 className="mt-6 mb-2 text-sm font-medium text-muted">{t.install.title}</h2>
      <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
        {standalone ? (
          <p>{t.install.installed}</p>
        ) : (
          <>
            <p>{t.install.hint}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {canInstall && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void promptInstall()}
                >
                  <Download className="size-4" aria-hidden="true" />
                  {t.install.button}
                </button>
              )}
              {ios && (
                <button type="button" className="btn btn-primary" onClick={() => setSteps(true)}>
                  <Smartphone className="size-4" aria-hidden="true" />
                  {t.install.iosButton}
                </button>
              )}
            </div>
            {!canInstall && !ios && <p className="mt-2 text-muted">{t.install.otherBrowsers}</p>}
          </>
        )}
      </div>
      {steps && <IosInstallDialog onClose={() => setSteps(false)} />}
    </>
  )
}

const bannerDismissed = () => {
  try {
    return localStorage.getItem(BANNER_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Shown once on iPhone in Safari (docs/PLAN.md §4.6): Safari has no persistent storage and may
 * clear the data of a site that is not on the home screen. Closed for good with "Închide".
 */
export function IosInstallBanner({ className = '' }: { className?: string }) {
  const [show, setShow] = useState(() => isIos() && !isStandalone() && !bannerDismissed())
  const [steps, setSteps] = useState(false)
  if (!show) return null

  function close() {
    setShow(false)
    try {
      localStorage.setItem(BANNER_KEY, '1')
    } catch {
      /* shown again next time: harmless */
    }
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm ${className}`}
    >
      <Smartphone className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p>{t.install.bannerText}</p>
        <button
          type="button"
          className="mt-1 min-h-11 font-medium text-accent underline underline-offset-2"
          onClick={() => setSteps(true)}
        >
          {t.install.bannerHow}
        </button>
      </div>
      <button
        type="button"
        className="-mt-1 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:text-ink"
        aria-label={t.common.close}
        onClick={close}
      >
        <X className="size-5" aria-hidden="true" />
      </button>
      {steps && <IosInstallDialog onClose={() => setSteps(false)} />}
    </div>
  )
}
