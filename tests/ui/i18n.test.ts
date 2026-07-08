import { describe, it, expect } from 'vitest'
import { t, pickLocale, resolveMessage } from '../../src/ui/i18n'
import { en } from '../../src/locales/en'
import { es } from '../../src/locales/es'
import { eu } from '../../src/locales/eu'
import { fr } from '../../src/locales/fr'

describe('i18n', () => {
  describe('pickLocale', () => {
    it('returns the primary subtag for a supported locale', () => {
      expect(pickLocale('es-ES')).toBe('es')
    })

    it('is case-insensitive', () => {
      expect(pickLocale('ES-es')).toBe('es')
    })

    it('recognizes every shipped locale', () => {
      expect(pickLocale('en-US')).toBe('en')
      expect(pickLocale('eu-ES')).toBe('eu')
      expect(pickLocale('fr-FR')).toBe('fr')
    })

    it('falls back to en for an unsupported language tag', () => {
      expect(pickLocale('de-DE')).toBe('en')
    })

    it('falls back to en for a missing tag', () => {
      expect(pickLocale(undefined)).toBe('en')
      expect(pickLocale(null)).toBe('en')
      expect(pickLocale('')).toBe('en')
    })
  })

  describe('resolveMessage', () => {
    it('resolves an English message', () => {
      expect(resolveMessage('en', 'app.title')).toBe(en['app.title'])
    })

    it('resolves a message for each shipped locale', () => {
      expect(resolveMessage('es', 'hud.start')).toBe(es['hud.start'])
      expect(resolveMessage('eu', 'hud.start')).toBe(eu['hud.start'])
      expect(resolveMessage('fr', 'hud.start')).toBe(fr['hud.start'])
    })

    it('falls back to English for an unsupported locale code', () => {
      expect(resolveMessage('xx', 'hud.start')).toBe(en['hud.start'])
    })
  })

  describe('t', () => {
    it('returns a non-empty string for every message key', () => {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(t(key).length).toBeGreaterThan(0)
      }
    })

    it('translates the four shape labels referenced by SHAPES[].labelKey', () => {
      expect(t('shape.circle').length).toBeGreaterThan(0)
      expect(t('shape.line').length).toBeGreaterThan(0)
      expect(t('shape.square').length).toBeGreaterThan(0)
      expect(t('shape.triangle').length).toBeGreaterThan(0)
    })
  })
})
