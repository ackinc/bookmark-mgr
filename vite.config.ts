import * as fs from "node:fs/promises";
import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";

function flattenSrcDirs(): Plugin {
  return {
    name: "flatten-src-dirs",
    async closeBundle() {
      const distDir = resolve(__dirname, "dist");
      const srcDir = resolve(distDir, "src");

      try {
        const entries = await fs.readdir(srcDir, { withFileTypes: true });

        for (const entry of entries) {
          const srcPath = resolve(srcDir, entry.name);
          const destPath = resolve(distDir, entry.name);
          await fs.rename(srcPath, destPath);
        }

        await fs.rm(srcDir, { recursive: true, force: true });
      } catch {
        // src/ directory may not exist
      }
    },
  };
}

export default defineConfig({
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      cwd: resolve(__dirname, "src"),
      input: {
        newtab: "newtab/index.html",
        "background/main": "background/main.ts",
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
    minify: true,
    sourcemap: "inline",
  },
  plugins: [flattenSrcDirs()],
});
