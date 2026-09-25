import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const serve = resolve(
  dirname(require.resolve("@react-router/serve/package.json")),
  "dist/cli.js",
);
for (const [name, args] of [
  ["worker", ["build/worker/index.js"]],
  ["web", ["--import", "./scripts/web-shutdown.mjs", serve, "build/server/index.js"]],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: "production",
    },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.error, undefined, `${name} startup must fail promptly`);
  assert.notEqual(
    result.status,
    0,
    `${name} must reject incomplete production configuration`,
  );
  assert.match(
    result.stdout + result.stderr,
    /Missing required production environment variables/,
    `${name} must fail for the expected configuration reason`,
  );
  console.log(`${name}: rejected incomplete production configuration`);
}
