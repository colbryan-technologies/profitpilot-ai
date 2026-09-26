import { Container } from "@cloudflare/containers";
import { containerEnvironment } from "./environment";
interface Env {
  WEB: DurableObjectNamespace<ProfitPilotWeb>;
  JOBS: DurableObjectNamespace<ProfitPilotJobs>;
  [key: string]: unknown;
}
export class ProfitPilotWeb extends Container<Env> {
  defaultPort = 3000;
  sleepAfter = "10m";
  envVars = containerEnvironment(this.env);
  override async fetch(request: Request): Promise<Response> {
    // The SDK's default instance acquisition budget is only eight seconds.
    // Wait for cold starts before forwarding, without replaying app mutations.
    await this.startAndWaitForPorts({
      ports: [this.defaultPort],
      cancellationOptions: {
        instanceGetTimeoutMS: 60_000,
        portReadyTimeoutMS: 60_000,
        waitInterval: 500,
        abort: request.signal,
      },
    });
    return this.containerFetch(request);
  }
}
export class ProfitPilotJobs extends Container<Env> {
  sleepAfter = "10m";
  entrypoint = ["node", "build/worker/index.js"];
  envVars = containerEnvironment(this.env);
  async ensureRunning() {
    await this.start();
    this.renewActivityTimeout();
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One shared app process; tenancy is established by the existing Shopify authentication.
    // No public control route can launch or address the job container.
    try {
      return await env.WEB.getByName("web").fetch(request);
    } catch {
      return new Response(
        "ProfitPilot is temporarily unavailable. Please retry shortly.",
        {
          status: 503,
          headers: { "Retry-After": "30", "Cache-Control": "no-store" },
        },
      );
    }
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await env.JOBS.getByName("jobs").ensureRunning();
  },
} satisfies ExportedHandler<Env>;
