import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const SYSTEM_README = new URL('../VADOS-APPLICATION-SYSTEMS/README.md', import.meta.url);

function readSystemVersion(): string | null {
  try {
    const firstLine = readFileSync(SYSTEM_README, 'utf8').split(/\r?\n/)[0];
    return firstLine.match(/^Version (\d+\.\d+\.\d+)$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export default defineConfig({
  base: './',
  define: {
    __SYSTEM_VERSION__: JSON.stringify(readSystemVersion()),
  },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: '@use "@/style/variables.scss" as *;\n@use "@/style/mixins.scss" as *;\n',
      },
    },
  },
});
