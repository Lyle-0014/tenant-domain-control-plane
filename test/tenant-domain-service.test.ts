import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { InfraiClient } from "../src/infrai-client.js";
import { MemoryTenantRepository, TenantDomainService, verifyWebhook } from "../src/tenant-domain-service.js";

test("a signed verification event activates the tenant without another DNS call", async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fakeClient = {
    request: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (path === "/v1/dns/domain/add") return { zone_id: "zone_tenant_42" };
      return {};
    },
  } as InfraiClient;
  const service = new TenantDomainService(fakeClient, new MemoryTenantRepository());
  const pending = await service.onboard({ tenantId: "tenant_42", domain: "app.acme.test", target: "edge.example.test" });
  assert.equal(pending.status, "verifying");
  assert.equal((calls[1].body as { zone_id: string }).zone_id, "zone_tenant_42");

  const body = JSON.stringify({ event: "dns.domain.verified", data: { domain: "app.acme.test" } });
  const signature = createHmac("sha256", "local-secret").update(body).digest("hex");
  assert.equal(verifyWebhook(body, `sha256=${signature}`, "local-secret"), true);
  const active = await service.acceptVerifiedDomain("app.acme.test");

  assert.equal(active?.status, "active");
  assert.equal(calls.length, 3);
});
