import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function filesIn(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(filename, base));
    else if (entry.isFile()) files.push(relative(base, filename).replaceAll("\\", "/"));
  }
  return files.sort();
}

function constant(source, name) {
  const match = source.match(new RegExp(`\\bconst ${name}\\s*=\\s*([^;]+);`));
  if (!match) throw new Error(`O service worker não contém ${name}.`);
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new Error(`${name} não foi substituído por dados válidos no build.`);
  }
}

/** Inspect generated files without executing the worker or accessing the network. */
export async function checkBuild(directory = resolve(root, "dist")) {
  const files = await filesIn(directory);
  for (const required of ["index.html", "sw.js", "manifest.webmanifest"]) {
    if (!files.includes(required)) throw new Error(`Arquivo obrigatório ausente: ${required}.`);
  }
  const source = await readFile(join(directory, "sw.js"), "utf8");
  const version = constant(source, "BUILD_VERSION");
  if (typeof version !== "string" || !/^[0-9a-f]{16}$/.test(version)) {
    throw new Error("A versão do cache offline não foi gerada pelo build.");
  }
  const urls = constant(source, "PRECACHE_URLS");
  if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string")) {
    throw new Error("A lista de arquivos offline é inválida.");
  }
  const expected = new Set(["/", ...files.filter((file) => file !== "sw.js").map((file) => `/${file}`)]);
  const actual = new Set(urls);
  if (actual.size !== urls.length) throw new Error("O cache offline contém URLs repetidas.");
  for (const url of expected) {
    if (!actual.has(url)) throw new Error(`Arquivo ausente do cache offline: ${url}.`);
  }
  for (const url of actual) {
    if (!expected.has(url)) throw new Error(`URL inesperada no cache offline: ${url}.`);
  }
  if (!files.some((file) => /^assets\/.+\.js$/.test(file)) ||
      !files.some((file) => /^assets\/.+\.css$/.test(file))) {
    throw new Error("O build deve conter os arquivos JavaScript e CSS do app.");
  }
  const html = await readFile(join(directory, "index.html"), "utf8");
  if (/\/src\/main\.tsx/.test(html)) throw new Error("O HTML ainda referencia o código de desenvolvimento.");
  const manifest = JSON.parse(await readFile(join(directory, "manifest.webmanifest"), "utf8"));
  if (manifest.start_url !== "/" || manifest.scope !== "/" || manifest.display !== "standalone") {
    throw new Error("O manifesto deve manter início, escopo e instalação atuais.");
  }
  if (!Array.isArray(manifest.icons) || !manifest.icons.length) {
    throw new Error("O manifesto deve referenciar os ícones de instalação.");
  }
  for (const icon of manifest.icons) {
    if (typeof icon.src !== "string" || !expected.has(icon.src) || icon.src === "/") {
      throw new Error("Um ícone do manifesto não está disponível no build.");
    }
  }
  return { files: files.length, cached: urls.length, version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkBuild(process.argv[2] ? resolve(process.argv[2]) : undefined);
    console.log(`Build verificado: ${result.files} arquivos; ${result.cached} URLs offline; cache ${result.version}.`);
  } catch (error) {
    console.error(`Falha na verificação do build: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    process.exitCode = 1;
  }
}
