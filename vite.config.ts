import { defineConfig, Plugin } from "vite";
import { resolve } from "path";
import { promises as fs } from "fs";

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
      input: {
        newtab: resolve(__dirname, "src/newtab/index.html"),
      },
    },
  },
  plugins: [flattenSrcDirs()],
});
