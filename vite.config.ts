import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages project site:
  // https://ljq61.github.io/Ricochet-Rivals/
  // Keep the dev server at `/` so the existing local/E2E workflow is unchanged.
  base: command === 'build' || isPreview ? '/Ricochet-Rivals/' : '/',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
  },
}));
