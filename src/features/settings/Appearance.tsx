import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { saveSettings } from '@/data/settings'
import { t } from '@/i18n/ro'
import {
  TEXT_SIZES,
  THEMES,
  applyAppearance,
  resolveAppearance,
  type Appearance,
} from '@/lib/appearance'
import { useSyncRuntime } from '@/sync/SyncContext'

/** The appearance in effect: the account's settings over this device's last choice. */
function useAppearance(): Appearance {
  const { db, userId } = useSyncRuntime()
  const profile = useLiveQuery(() => db.profiles.get(userId), [db, userId])
  return resolveAppearance(profile?.settings)
}

/**
 * Keeps the page in step with the settings, also when another device changes them (they arrive
 * with the pull) and, for "Automată", when the system switches between light and dark.
 */
export function AppearanceSync() {
  const { theme, textSize } = useAppearance()
  useEffect(() => {
    applyAppearance({ theme, textSize })
    if (theme !== 'auto' || typeof matchMedia !== 'function') return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyAppearance({ theme, textSize })
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme, textSize])
  return null
}

interface ChoiceProps<T> {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

function Choice<T extends string | number>({ label, options, value, onChange }: ChoiceProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
    >
      {options.map((option) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(option.value)}
            className={`btn min-h-11 justify-center ${checked ? 'btn-primary' : 'btn-secondary'}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** "Aspect" in Settings: theme and the text size of notes, synced with the account. */
export function AppearanceSection() {
  const { db, engine, userId } = useSyncRuntime()
  const appearance = useAppearance()

  async function change(patch: Partial<Appearance>) {
    applyAppearance({ ...appearance, ...patch })
    await saveSettings(db, userId, patch)
    engine.requestPush()
  }

  return (
    <>
      <h2 className="mt-6 mb-2 text-sm font-medium text-muted">{t.settings.appearance}</h2>
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface px-4 py-3">
        <div>
          <p className="mb-2 text-sm font-medium">{t.settings.theme}</p>
          <Choice
            label={t.settings.theme}
            options={THEMES.map((theme) => ({ value: theme, label: t.settings.themes[theme] }))}
            value={appearance.theme}
            onChange={(theme) => void change({ theme })}
          />
          <p className="mt-2 text-xs text-muted">{t.settings.themeAutoHint}</p>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{t.settings.textSize}</p>
          <Choice
            label={t.settings.textSize}
            options={TEXT_SIZES.map((_, index) => ({
              value: index,
              label: t.settings.textSizes[index] ?? String(index + 1),
            }))}
            value={appearance.textSize}
            onChange={(textSize) => void change({ textSize })}
          />
          <p className="mt-3 font-serif" style={{ fontSize: 'var(--bn-note-size, 1.125rem)' }}>
            {t.settings.textPreview}
          </p>
        </div>
      </div>
    </>
  )
}
