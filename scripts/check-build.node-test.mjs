import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkBuild } from "./check-build.mjs";

async function fixture(t, change = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), "cash-tracker-harness-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  await mkdir(join(directory, "icons"));
  const files = ["index.html", "manifest.webmanifest", "assets/index-example.js", "assets/index-example.css", "assets/auth-example.js", "icons/icon.png"];
  const urls = ["/", ...files.map((file) => `/${file}`)];
  const build = { version: "0123456789abcdef", urls };
  change(build);
  for (const file of files) await writeFile(join(directory, file), "synthetic artifact");
  await writeFile(join(directory, "index.html"), '<html><script src="/assets/index-example.js"></script></html>');
  await writeFile(join(directory, "manifest.webmanifest"), JSON.stringify({
    start_url: "/", scope: "/", display: "standalone", icons: [{ src: "/icons/icon.png" }],
  }));
  await writeFile(join(directory, "sw.js"), `const BUILD_VERSION = ${JSON.stringify(build.version)};\nconst PRECACHE_URLS = ${JSON.stringify(build.urls)};`);
  return directory;
}

test("aceita um build completo, incluindo o chunk de autenticação", async (t) => {
  const result = await checkBuild(await fixture(t));
  assert.equal(result.files, 7);
  assert.equal(result.cached, 7);
});

test("rejeita chunk lazy omitido do cache mesmo com o shell presente", async (t) => {
  const directory = await fixture(t, (build) => {
    build.urls = build.urls.filter((url) => url !== "/assets/auth-example.js");
  });
  await assert.rejects(checkBuild(directory), /Arquivo ausente do cache offline: \/assets\/auth-example\.js/);
});

test("rejeita cache que referencia um arquivo removido", async (t) => {
  const directory = await fixture(t);
  await rm(join(directory, "assets/auth-example.js"));
  await assert.rejects(checkBuild(directory), /URL inesperada no cache offline/);
});

test("rejeita worker de desenvolvimento e URLs externas", async (t) => {
  await assert.rejects(checkBuild(await fixture(t, (build) => { build.version = "local"; })), /versão do cache offline/);
  await assert.rejects(checkBuild(await fixture(t, (build) => { build.urls.push("https://example.com/file.js"); })), /URL inesperada/);
});

test("rejeita manifesto com ícone que não existe", async (t) => {
  const directory = await fixture(t);
  const filename = join(directory, "manifest.webmanifest");
  const manifest = JSON.parse(await readFile(filename, "utf8"));
  manifest.icons[0].src = "/icons/missing.png";
  await writeFile(filename, JSON.stringify(manifest));
  await assert.rejects(checkBuild(directory), /ícone do manifesto/);
});
