import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Use a separate origin (port 5174/4174) and force local storage without
// changing .env.local or contacting the configured Supabase project.
const mode = process.argv[2];
const extra = process.argv.slice(3);
const root = fileURLToPath(new URL("../", import.meta.url));
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command, ...args], {
      cwd: root,
      env: { ...process.env, VITE_STORAGE_MODE: "local" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

try {
  let code;
  if (mode === "dev") {
    code = await run(vite, ["--host", "127.0.0.1", "--port", "5174", "--strictPort", ...extra]);
  } else if (mode === "build") {
    code = await run(tsc, ["--noEmit"]);
    if (code === 0) code = await run(vite, ["build", ...extra]);
  } else if (mode === "preview") {
    // Preview cannot change the mode compiled into dist. Always rebuild first.
    code = await run(tsc, ["--noEmit"]);
    if (code === 0) code = await run(vite, ["build"]);
    if (code === 0) code = await run(vite, ["preview", "--host", "127.0.0.1", "--port", "4174", "--strictPort", ...extra]);
  } else {
    throw new Error("Use dev, build ou preview para o ambiente local.");
  }
  process.exitCode = code;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Não foi possível iniciar o ambiente local.");
  process.exitCode = 1;
}
