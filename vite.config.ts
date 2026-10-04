import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, isPreview, mode }) => ({
  // GitHub Pages project site:
  // https://ljq61.github.io/Ricochet-Rivals/
  // Keep the dev server at `/` so the existing local/E2E workflow is unchanged.
  base: mode === 'crazygames' ? './' : command === 'build' || isPreview ? '/Ricochet-Rivals/' : '/',
  publicDir: mode === 'crazygames' ? '.crazygames-assets' : 'public',
  build: { outDir: mode === 'crazygames' ? 'dist-crazygames' : 'dist' },
  plugins: mode === 'crazygames' ? [{
    name: 'crazygames-html',
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string) => html
        .replace(/assets\/art\/([^\s"'()<>]+)\.(png|jpg)/g, 'assets/art/$1.webp')
        .replace("url('/assets/", "url('%BASE_URL%assets/")
        .replace('lang="zh-CN"', 'lang="en"')
        .replace('Ricochet Rivals 正在加载', 'Loading Ricochet Rivals')
        .replace('游戏资源加载进度', 'Game loading progress')
        .replace('正在准备出航…', 'Preparing to sail…')
        .replace('请将设备横过来游玩', 'Rotate your device to play')
        .replace('Ricochet Rivals 仅支持横屏', 'Ricochet Rivals plays in landscape'),
    },
  }] : [],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
  },
}));
