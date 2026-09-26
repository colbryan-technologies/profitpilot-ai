import { Container } from "@cloudflare/containers";
import { containerEnvironment } from "./environment";
import { failureCategory } from "../../app/lib/failure-category";
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
    const started = Date.now();
    let stage = "container_startup";
    try {
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
      stage = "container_forward";
      const response = await this.containerFetch(request);
      if (response.status >= 500)
        console.error("profitpilot_diagnostic", {
          stage: "container_response",
          status: response.status,
          elapsedMs: Date.now() - started,
        });
      return response;
    } catch (error) {
      console.error("profitpilot_diagnostic", {
        stage,
        category: failureCategory(error),
        elapsedMs: Date.now() - started,
      });
      throw error;
    }
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
    const started = Date.now();
    try {
      return await env.WEB.getByName("web").fetch(request);
    } catch (error) {
      console.error("profitpilot_diagnostic", {
        stage: "worker_dispatch",
        category: failureCategory(error),
        elapsedMs: Date.now() - started,
      });
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
