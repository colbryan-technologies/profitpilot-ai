import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("ioredis", () => ({
  default: class {
    constructor(...args: unknown[]) {
      return mocks.create(...args);
    }
  },
}));
vi.mock("../../app/lib/env.server", () => ({
  env: () => ({ REDIS_URL: "rediss://example.test" }),
}));
vi.mock("../../app/lib/logger.server", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

function fakeRedis() {
  return {
    status: "wait",
    on: vi.fn(),
    connect: vi.fn<() => Promise<void>>(),
    disconnect: vi.fn(),
    eval: vi.fn().mockResolvedValue([1, 60000]),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it("allows a cold connection longer than the command timeout and shares readiness across loaders", async () => {
  const redis = fakeRedis();
  redis.connect.mockImplementation(() => {
    redis.status = "connecting";
    return new Promise((resolve) =>
      setTimeout(() => {
        redis.status = "ready";
        resolve();
      }, 3500),
    );
  });
  mocks.create.mockReturnValue(redis);
  const { consumeRateLimit } =
    await import("../../app/services/rate-limit.server");
  const first = consumeRateLimit("a", "requests", 5, 60000);
  const second = consumeRateLimit("b", "requests", 5, 60000);
  await vi.advanceTimersByTimeAsync(2500);
  expect(redis.eval).not.toHaveBeenCalled();
  expect(redis.connect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  await Promise.all([first, second]);
  expect(redis.eval).toHaveBeenCalledTimes(2);
  await consumeRateLimit("a", "requests", 5, 60000);
  expect(redis.connect).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
    "rediss://example.test",
    expect.objectContaining({
      lazyConnect: true,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
    }),
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds stalled readiness, fails closed, and lets the next request create a fresh connection", async () => {
  const stalled = fakeRedis();
  stalled.connect.mockReturnValue(new Promise(() => {}));
  const recovered = fakeRedis();
  recovered.connect.mockImplementation(async () => {
    recovered.status = "ready";
  });
  mocks.create.mockReturnValueOnce(stalled).mockReturnValueOnce(recovered);
  const { consumeRateLimit } =
    await import("../../app/services/rate-limit.server");
  const rejected = expect(
    consumeRateLimit("a", "requests", 5, 60000),
  ).rejects.toMatchObject({ status: 503 });
  await vi.advanceTimersByTimeAsync(10000);
  await rejected;
  expect(stalled.eval).not.toHaveBeenCalled();
  expect(stalled.disconnect).toHaveBeenCalledTimes(1);
  await consumeRateLimit("a", "requests", 5, 60000);
  expect(recovered.eval).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not replay admission after an ambiguous command failure", async () => {
  const redis = fakeRedis();
  redis.connect.mockImplementation(async () => {
    redis.status = "ready";
  });
  redis.eval.mockRejectedValue(new Error("Command timed out"));
  mocks.create.mockReturnValue(redis);
  const { consumeRateLimit } =
    await import("../../app/services/rate-limit.server");
  await expect(
    consumeRateLimit("a", "requests", 5, 60000),
  ).rejects.toMatchObject({ status: 503 });
  expect(redis.eval).toHaveBeenCalledTimes(1);
  expect(redis.disconnect).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

it("replaces a closed idle connection before issuing the next admission", async () => {
  const first = fakeRedis();
  first.connect.mockImplementation(async () => {
    first.status = "ready";
  });
  const second = fakeRedis();
  second.connect.mockImplementation(async () => {
    second.status = "ready";
  });
  mocks.create.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const { consumeRateLimit } =
    await import("../../app/services/rate-limit.server");
  await consumeRateLimit("a", "requests", 5, 60000);
  first.status = "end";
  await consumeRateLimit("a", "requests", 5, 60000);
  expect(first.eval).toHaveBeenCalledTimes(1);
  expect(second.eval).toHaveBeenCalledTimes(1);
});
