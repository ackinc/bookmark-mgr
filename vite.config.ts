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

function placeBackgroundWorker(): Plugin {
  return {
    name: "place-background-worker",
    async closeBundle() {
      const distDir = resolve(__dirname, "dist");
      const assetsDir = resolve(distDir, "assets");

      try {
        const entries = await fs.readdir(assetsDir);
        const bgFile = entries.find(
          (f) => f.startsWith("background-") && f.endsWith(".js"),
        );
        if (!bgFile) return;

        const bgDir = resolve(distDir, "background");
        await fs.mkdir(bgDir, { recursive: true });
        await fs.rename(resolve(assetsDir, bgFile), resolve(bgDir, "main.js"));

        // Also move the sourcemap if it exists
        const mapFile = bgFile.replace(".js", ".js.map");
        if (entries.includes(mapFile)) {
          await fs.rename(
            resolve(assetsDir, mapFile),
            resolve(bgDir, "main.js.map"),
          );
        }
      } catch {
        // background asset may not exist
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
        background: resolve(__dirname, "src/background/main.ts"),
      },
    },
    sourcemap: "inline",
  },
  plugins: [flattenSrcDirs(), placeBackgroundWorker()],
});
