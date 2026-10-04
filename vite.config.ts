import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages project site:
  // https://ljq61.github.io/Ricochet-Rivals/
  // Keep the dev server at `/` so the existing local/E2E workflow is unchanged.
  base: command === 'build' || isPreview ? '/Ricochet-Rivals/' : '/',
  publicDir: command === 'build' || isPreview ? '.optimized-assets' : 'public',
  plugins: command === 'build' ? [{
    name: 'optimized-startup-art',
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string) => html.replace(/assets\/art\/([^\s"'()<>]+)\.(png|jpe?g)/gi, 'assets/art/$1.webp'),
    },
  }] : [],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
  },
}));
