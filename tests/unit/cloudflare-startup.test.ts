import { beforeEach, expect, it, vi } from "vitest";

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
