import { describe, expect, it } from 'vitest'
import { extractShareToken, shareUrl } from './shareLink'

const token = 'share-token-share-token-share-token-share-t'

describe('extractShareToken', () => {
  it('finds the token in a link, in a longer message, or alone', () => {
    expect(extractShareToken(`https://biblenote-app.vercel.app/s/${token}`)).toBe(token)
    expect(extractShareToken(`Uite folderul: https://biblenote-app.vercel.app/s/${token} 🙏`)).toBe(
      token,
    )
    expect(extractShareToken(`  ${token}\n`)).toBe(token)
  })

  it('refuses text without a token', () => {
    expect(extractShareToken('')).toBeNull()
    expect(extractShareToken('https://biblenote-app.vercel.app/f/abc')).toBeNull()
    expect(extractShareToken('salut, ce faci?')).toBeNull()
    expect(extractShareToken('/s/scurt')).toBeNull()
  })

  it('builds the link on this site', () => {
    expect(shareUrl(token, 'https://biblenote-app.vercel.app')).toBe(
      `https://biblenote-app.vercel.app/s/${token}`,
    )
  })
})
