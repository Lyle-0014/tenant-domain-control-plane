import { createServer, type ServerResponse } from "node:http";
import { z, ZodError } from "zod";
import { InfraiClient, InfraiError } from "./infrai-client.js";
import {
  MemoryTenantRepository,
  onboardingBody,
  TenantDomainService,
  verificationEvent,
  verifyWebhook,
} from "./tenant-domain-service.js";

const apiKey = requiredEnv("INFRAI_API_KEY");
const webhookSecret = requiredEnv("INFRAI_WEBHOOK_SECRET");
const service = new TenantDomainService(new InfraiClient(apiKey), new MemoryTenantRepository());

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "POST" && url.pathname === "/admin/tenant-domains") {
      const input = onboardingBody.parse(JSON.parse(await readBody(request)));
      return json(response, 202, await service.onboard(input));
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/admin/tenant-domains/")) {
      const domain = decodeURIComponent(url.pathname.slice("/admin/tenant-domains/".length));
      const tenant = await service.disable(domain);
      return tenant ? json(response, 200, tenant) : json(response, 404, { error: "Tenant domain not found" });
    }
    if (request.method === "POST" && url.pathname === "/webhooks/infrai") {
      const rawBody = await readBody(request);
      const signature = request.headers["x-infrai-signature"];
      if (typeof signature !== "string" || !verifyWebhook(rawBody, signature, webhookSecret)) {
        return json(response, 401, { error: "Invalid signature" });
      }
      const event = verificationEvent.parse(JSON.parse(rawBody));
      const tenant = await service.acceptVerifiedDomain(event.data.domain);
      return tenant ? json(response, 200, tenant) : json(response, 202, { received: true });
    }
    return json(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return json(response, 400, { error: "Invalid request body" });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return json(response, status, { error: error.message, code: error.code });
    }
    console.error(error);
    return json(response, 500, { error: "Unexpected service error" });
  }
}).listen(Number(process.env.PORT ?? 3000), () => console.log("Tenant domain control plane listening on http://localhost:3000"));

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readBody(request: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}
