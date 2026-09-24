import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "@prisma/config";
describe("patched Prisma configuration dependency", () => {
  it("loads typed configuration through Prisma's real loader", async () => {
    const result = await loadConfigFromFile({
      configRoot: process.cwd(),
      configFile: "tests/fixtures/prisma.compat.config.ts",
    });
    expect(result.error).toBeUndefined();
    expect(result.config?.schema).toBe(resolve("prisma/schema.prisma"));
    expect(result.config?.migrations?.path).toBe(resolve("prisma/migrations"));
  });
});
