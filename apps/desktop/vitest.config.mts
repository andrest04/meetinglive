import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Renderer component tests opt in with a `// @vitest-environment jsdom` pragma.
    setupFiles: ['./src/renderer/test-setup.ts'],
  },
});
