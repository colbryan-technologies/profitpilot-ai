import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";

// Exercise the shutdown preload in a separate process with an open HTTP server
// and a persistent background handle, like a Redis reconnect timer.
for (const signal of ["SIGTERM", "SIGINT"]) {
  const child = spawn(process.execPath, [
    "--import", "./scripts/web-shutdown.mjs", "--input-type=module", "-e",
    `import http from 'node:http';
     const server = http.createServer((req, res) => res.end('ok'));
     setInterval(() => {}, 1000);
     process.once('${signal}', () => server.close());
     process.on('message', () => process.emit('${signal}'));
     server.listen(0, '127.0.0.1', () => process.send('ready'));`,
  ], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const timer = setTimeout(() => child.kill("SIGKILL"), 9_000);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("message", () => {
      // Windows has no Unix signal delivery; run the same handler through IPC.
      if (process.platform === "win32") child.send("stop");
      else child.kill(signal);
    });
    child.once("exit", (code, exitSignal) => resolve({ code, exitSignal }));
  }).finally(() => clearTimeout(timer));
  assert.deepEqual(result, { code: 0, exitSignal: null }, `${signal}: web must exit despite background handles`);
  console.log(`${signal}: bounded web shutdown passed`);
}
