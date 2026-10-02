import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

function offlineAssets(): Plugin {
  return {
    name: "cash-tracker-offline-assets",
    apply: "build",
    async closeBundle() {
      const directory = join(process.cwd(), "dist");
      const files: string[] = [];
      async function walk(path: string) {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const file = join(path, entry.name);
          if (entry.isDirectory()) await walk(file);
          else if (entry.name !== "sw.js") files.push(file);
        }
      }
      await walk(directory);
      files.sort();
      const hash = createHash("sha256");
      const rawWorker = await readFile(join(directory, "sw.js"), "utf8");
      if (
        !rawWorker.includes('/* CASH_TRACKER_VERSION */ "local"') ||
        !/\/\* CASH_TRACKER_PRECACHE \*\/ \[[^\]]*\]/.test(rawWorker)
      ) {
        throw new Error(
          "Os marcadores do cache offline não foram encontrados. O build foi interrompido para evitar uma PWA incompleta.",
        );
      }
      hash.update(rawWorker);
      for (const file of files) {
        hash.update(relative(directory, file));
        hash.update(await readFile(file));
      }
      const urls = [
        "/",
        ...files.map(
          (file) => `/${relative(directory, file).replaceAll("\\", "/")}`,
        ),
      ];
      const worker = rawWorker
        .replace(
          /\/\* CASH_TRACKER_VERSION \*\/ "local"/,
          JSON.stringify(hash.digest("hex").slice(0, 16)),
        )
        .replace(
          /\/\* CASH_TRACKER_PRECACHE \*\/ \[[^\]]*\]/,
          JSON.stringify(urls),
        );
      await writeFile(join(directory, "sw.js"), worker);
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineAssets()],
  build: { target: "es2020" },
});
