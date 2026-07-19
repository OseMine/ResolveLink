import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15000,
    include: ['test/**/*.test.{js,ts}'],
    exclude: ['node_modules', 'src', 'dist'],
  },
});
