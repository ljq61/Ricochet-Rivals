import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveLocale } from '../../src/game/i18n/locale';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('presentation locale', () => {
  it('defaults to English only for the CrazyGames build', () => {
    expect(resolveLocale('crazygames')).toBe('en');
    for (const mode of ['development', 'production', 'test']) expect(resolveLocale(mode)).toBe('zh');
  });
  it('accepts only explicit supported language overrides', () => {
    expect(resolveLocale('production', '?lang=en')).toBe('en');
    expect(resolveLocale('crazygames', '?lang=zh')).toBe('zh');
    for (const search of ['?lang=fr', '?lang=', '?language=zh']) expect(resolveLocale('crazygames', search)).toBe('en');
  });
  it('uses the build mode for platform behavior even with a Chinese override', async () => {
    vi.stubEnv('MODE', 'crazygames');
    vi.stubGlobal('window', { location: { search: '?lang=zh' } });
    vi.resetModules();
    const locale = await import('../../src/game/i18n/locale');
    expect(locale.isCrazyGamesBuild()).toBe(true);
    expect(locale.getLocale()).toBe('zh');
    expect(locale.t('背包', 'Bag')).toBe('背包');
  });
  it('localizes fallback DOM accessibility and rotation text before scenes start', async () => {
    vi.stubEnv('MODE', 'crazygames');
    vi.stubGlobal('window', { location: { search: '' } });
    vi.resetModules();
    const locale = await import('../../src/game/i18n/locale');
    const elements = new Map(['startup-loading', 'startup-loading-progress', 'rotate-overlay-title', 'rotate-overlay-hint'].map(id => [id,
      { textContent: '', setAttribute: vi.fn() }]));
    const doc = { documentElement: { lang: '' }, getElementById: (id: string) => elements.get(id) ?? null };
    locale.initializeLocaleDocument(doc as unknown as Document);
    expect(doc.documentElement.lang).toBe('en');
    expect(elements.get('startup-loading')!.setAttribute).toHaveBeenCalledWith('aria-label', 'Loading Ricochet Rivals');
    expect(elements.get('startup-loading-progress')!.setAttribute).toHaveBeenCalledWith('aria-label', 'Game loading progress');
    expect(elements.get('rotate-overlay-title')!.textContent).toBe('Rotate your device to play');
    expect(elements.get('rotate-overlay-hint')!.textContent).toBe('Ricochet Rivals plays in landscape');
    expect(locale.t('瞄准', 'Aim')).toBe('Aim');
  });
});
