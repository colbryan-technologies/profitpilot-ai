import { createServer, type Socket } from "node:net";
import { expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ REDIS_URL: "" }));
vi.mock("../../app/lib/env.server", () => ({ env: () => config }));
vi.mock("../../app/lib/logger.server", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

// A small RESP peer exercises the real ioredis handshake/command timers without
// external services. Lua behavior is covered by the existing rate-limit tests.
it("waits for a slow Redis INFO handshake before sending admission with the real client", async () => {
  const sockets = new Set<Socket>();
  const commands: string[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const countEnd = buffer.indexOf("\r\n");
        if (countEnd < 0) return;
        const count = Number(buffer.slice(1, countEnd));
        let offset = countEnd + 2;
        const args: string[] = [];
        for (let i = 0; i < count; i++) {
          const lengthEnd = buffer.indexOf("\r\n", offset);
          if (lengthEnd < 0) return;
          const length = Number(buffer.slice(offset + 1, lengthEnd));
          const start = lengthEnd + 2;
          if (buffer.length < start + length + 2) return;
          args.push(buffer.slice(start, start + length));
          offset = start + length + 2;
        }
        buffer = buffer.slice(offset);
        const command = args[0].toLowerCase();
        commands.push(command);
        if (command === "info") {
          timers.push(
            setTimeout(() => {
              const info = "loading:0\r\n";
              socket.write(`$${info.length}\r\n${info}\r\n`);
            }, 2300),
          );
        } else if (command === "eval") {
          socket.write("*2\r\n:1\r\n:60000\r\n");
        } else {
          socket.write("+OK\r\n");
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test port");
    config.REDIS_URL = `redis://127.0.0.1:${address.port}`;
    const { consumeRateLimit } =
      await import("../../app/services/rate-limit.server");
    await consumeRateLimit("test-store", "requests", 5, 60000);
    expect(commands.filter((command) => command === "eval")).toHaveLength(1);
    expect(commands.indexOf("info")).toBeLessThan(commands.indexOf("eval"));
    expect(sockets.size).toBe(1);
  } finally {
    timers.forEach(clearTimeout);
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10000);
