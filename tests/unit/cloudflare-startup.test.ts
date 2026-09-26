import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ wait: vi.fn(), forward: vi.fn() }));
vi.mock("@cloudflare/containers", () => ({
  Container: class {
    env = {};
    startAndWaitForPorts = mocks.wait;
    containerFetch = mocks.forward;
  },
}));
vi.mock("../../deploy/cloudflare/environment", () => ({
  containerEnvironment: () => ({}),
}));
// Keep the Workers runtime's types separate from the app's Node/DOM types.
const modulePath = "../../deploy/cloudflare/index";
const { ProfitPilotWeb, default: worker } = await import(modulePath);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.forward.mockResolvedValue(new Response("ready"));
});
afterEach(() => vi.restoreAllMocks());

it("logs app failure origin and separate durations without exposing response contents", async () => {
  vi.spyOn(Date, "now")
    .mockReturnValueOnce(1000)
    .mockReturnValueOnce(6000)
    .mockReturnValue(8000);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.forward.mockResolvedValue(
    new Response("private error body", {
      status: 503,
      headers: {
        "X-ProfitPilot-Response-Source": "redis_rate_limit",
        "Retry-After": "30",
      },
    }),
  );
  const response = await new ProfitPilotWeb().fetch(
    new Request("https://example.test/?token=secret"),
  );
  expect(log).toHaveBeenCalledExactlyOnceWith("profitpilot_diagnostic", {
    stage: "container_response",
    source: "redis_rate_limit",
    status: 503,
    startupMs: 5000,
    forwardMs: 2000,
    elapsedMs: 7000,
  });
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("30");
  expect(response.headers.has("X-ProfitPilot-Response-Source")).toBe(false);
  expect(await response.text()).toBe("private error body");
  expect(mocks.forward).toHaveBeenCalledTimes(1);
});

it("holds the first request until the container is listening", async () => {
  let ready!: () => void;
  mocks.wait.mockReturnValue(
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
  );
  const request = new Request("https://example.test/app");
  const pending = new ProfitPilotWeb().fetch(request);
  expect(mocks.forward).not.toHaveBeenCalled();
  expect(mocks.wait).toHaveBeenCalledWith({
    ports: [3000],
    cancellationOptions: {
      instanceGetTimeoutMS: 60_000,
      portReadyTimeoutMS: 60_000,
      waitInterval: 500,
      abort: request.signal,
    },
  });
  ready();
  expect(await (await pending).text()).toBe("ready");
  expect(mocks.forward).toHaveBeenCalledExactlyOnceWith(request);
});

it("returns a noncached 503 if startup cannot complete", async () => {
  mocks.wait.mockRejectedValue(new Error("startup timeout"));
  const web = new ProfitPilotWeb();
  const response = await worker.fetch(new Request("https://example.test/app"), {
    WEB: { getByName: () => web },
  });
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.forward).not.toHaveBeenCalled();
});

it("never retries a mutation after it has been forwarded", async () => {
  mocks.wait.mockResolvedValue(undefined);
  mocks.forward.mockRejectedValue(new Error("connection lost"));
  const request = new Request("https://example.test/app/data-health", {
    method: "POST",
    body: "intent=resync",
  });
  await expect(new ProfitPilotWeb().fetch(request)).rejects.toThrow(
    "connection lost",
  );
  expect(mocks.forward).toHaveBeenCalledExactlyOnceWith(request);
});
