import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Mirrors tsconfig's "@/*" path alias so a SUT that imports via "@/lib/..."
  // resolves the same way it does under Next.js.
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/calculations.ts', 'lib/ledEngineering.ts', 'lib/permissions.ts', 'lib/recordStore.ts']
    }
  }
});
