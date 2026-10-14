import type { Json } from './database.types'

/**
 * Theme and note text size: saved on the device at once (localStorage, read
 * by index.html before the first paint) and in the account (profiles.settings, last write wins),
 * so every device follows the last choice.
 */
export type Theme = 'light' | 'dark' | 'auto'
export const THEMES: readonly Theme[] = ['light', 'dark', 'auto']

/** The four text sizes of notes, in rem; 1 (1.125rem) is the default. */
export const TEXT_SIZES = [1, 1.125, 1.25, 1.4] as const
export const DEFAULT_TEXT_SIZE = 1

export interface Appearance {
  theme: Theme
  /** Index into TEXT_SIZES. */
  textSize: number
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'auto', textSize: DEFAULT_TEXT_SIZE }

const THEME_KEY = 'bn-theme'
const SIZE_KEY = 'bn-text-size'

const isTheme = (value: unknown): value is Theme =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value)
const isSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < TEXT_SIZES.length

/** The valid parts of a stored settings object (anything else is ignored). */
export function appearanceOf(settings: Json | undefined): Partial<Appearance> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {}
  const out: Partial<Appearance> = {}
  if (isTheme(settings.theme)) out.theme = settings.theme
  if (isSize(settings.textSize)) out.textSize = settings.textSize
  return out
}

/** What this device chose last (also before signing in). */
export function localAppearance(): Appearance {
  try {
    const theme = localStorage.getItem(THEME_KEY)
    const size = Number(localStorage.getItem(SIZE_KEY))
    return {
      theme: isTheme(theme) ? theme : DEFAULT_APPEARANCE.theme,
      textSize: localStorage.getItem(SIZE_KEY) !== null && isSize(size) ? size : DEFAULT_TEXT_SIZE,
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

/** The account's settings win over this device's last choice, key by key. */
export function resolveAppearance(settings: Json | undefined): Appearance {
  return { ...localAppearance(), ...appearanceOf(settings) }
}

export function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** Applies it to the page and remembers it on the device. */
export function applyAppearance({ theme, textSize }: Appearance): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark' || (theme === 'auto' && prefersDark()))
  root.style.setProperty('--bn-note-size', `${TEXT_SIZES[textSize] ?? 1.125}rem`)
  try {
    localStorage.setItem(THEME_KEY, theme)
    localStorage.setItem(SIZE_KEY, String(textSize))
  } catch {
    /* storage unavailable: the page still shows the choice */
  }
}
