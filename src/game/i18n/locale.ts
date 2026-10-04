export type Locale = 'zh' | 'en';

/** Language is presentation-only: it never changes match state, RNG or wire messages. */
export function resolveLocale(mode: string, search = ''): Locale {
  const requested = new URLSearchParams(search).get('lang');
  if (requested === 'en' || requested === 'zh') return requested;
  return mode === 'crazygames' ? 'en' : 'zh';
}

export function isCrazyGamesBuild(): boolean {
  return import.meta.env.MODE === 'crazygames';
}

const locale = resolveLocale(import.meta.env.MODE, typeof window === 'undefined' ? '' : window.location?.search ?? '');

export function getLocale(): Locale { return locale; }

/** Keep paired copy beside its UI so both translations evolve with the same behavior. */
export function t(zh: string, en: string): string {
  return locale === 'en' ? en : zh;
}

/** Update static pre-module fallback text, including accessibility and rotation prompts. */
export function initializeLocaleDocument(doc: Document = document): void {
  doc.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  doc.getElementById('startup-loading')?.setAttribute('aria-label', t('Ricochet Rivals 正在加载', 'Loading Ricochet Rivals'));
  doc.getElementById('startup-loading-progress')?.setAttribute('aria-label', t('游戏资源加载进度', 'Game loading progress'));
  const rotationTitle = doc.getElementById('rotate-overlay-title');
  const rotationHint = doc.getElementById('rotate-overlay-hint');
  if (rotationTitle) rotationTitle.textContent = t('请将设备横过来游玩', 'Rotate your device to play');
  if (rotationHint) rotationHint.textContent = t('Ricochet Rivals 仅支持横屏', 'Ricochet Rivals plays in landscape');
}
