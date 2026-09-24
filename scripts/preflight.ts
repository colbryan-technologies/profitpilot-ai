import { existsSync } from "node:fs";
import { env, assertProductionEnv } from "../app/lib/env.server";

// Offline check only. Never print values or arbitrary exception messages.
let failed = false;
try {
  assertProductionEnv({ ...env(), NODE_ENV: "production" });
  console.log("PASS: required production settings have valid formats.");
} catch (error) {
  failed = true;
  const message = error instanceof Error ? error.message : "";
  const recognized =
    /^(Missing required production environment variables|Invalid production environment fields|Invalid environment fields): ([A-Za-z0-9_, .]+)$/.exec(
      message,
    );
  console.error(
    recognized
      ? `BLOCKED: ${recognized[1]}: ${recognized[2]}`
      : "BLOCKED: configuration could not be validated.",
  );
}
for (const file of ["build/server/index.js", "build/worker/index.js"]) {
  if (existsSync(file)) console.log(`PASS: ${file} exists.`);
  else {
    failed = true;
    console.error(`BLOCKED: ${file} is missing. Run the production build.`);
  }
}
console.log(
  "Offline check only: credentials, connectivity, migrations, Shopify configuration and live merchant flows are not verified.",
);
process.exitCode = failed ? 1 : 0;
