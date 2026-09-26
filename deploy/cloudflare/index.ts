import { Container } from "@cloudflare/containers";
import { containerEnvironment } from "./environment";
import { failureCategory } from "../../app/lib/failure-category";
import {
  responseFailureSource,
  RESPONSE_DIAGNOSTIC_HEADER,
} from "../../app/lib/response-diagnostic";
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
      const readyAt = Date.now();
      stage = "container_forward";
      const response = await this.containerFetch(request);
      if (response.status >= 500)
        console.error("profitpilot_diagnostic", {
          stage: "container_response",
          source: responseFailureSource(response.headers),
          status: response.status,
          startupMs: readyAt - started,
          forwardMs: Date.now() - readyAt,
          elapsedMs: Date.now() - started,
        });
      if (response.headers.has(RESPONSE_DIAGNOSTIC_HEADER)) {
        const headers = new Headers(response.headers);
        headers.delete(RESPONSE_DIAGNOSTIC_HEADER);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
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
