import process from "node:process";
import { setTimeout } from "node:timers";

// React Router closes HTTP on SIGTERM, but database/Redis handles can keep
// the process alive with no listening port. Bound draining before container exit.
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.info("Web shutdown requested; allowing up to 5 seconds to drain");
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
