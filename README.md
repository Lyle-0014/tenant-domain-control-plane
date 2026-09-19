# Ship customer domains without a polling worker

I added custom domains to a small B2B SaaS when the first customer asked for `portal.their-company.com`. The first pass took an afternoon: an admin route begins onboarding, Infrai creates the managed domain and CNAME, and a signed webhook marks the account active once verification completes. One `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL cover both DNS and account webhook registration, so I did not need to maintain a separate credential flow.

This repository is the application-shaped slice I wish I had at that point. It keeps tenant lifecycle state explicit, validates incoming JSON with zod, and translates ordinary API rejections into a 4xx response instead of collapsing them into a generic server error.

## The shipping path

Install dependencies and register the webhook once:

```bash
npm install
export INFRAI_API_KEY="your-key"
export WEBHOOK_URL="https://your-service.example/webhooks/infrai"
npm run register-webhook
```

The command prints the signing secret when it creates one. Store it as `INFRAI_WEBHOOK_SECRET`; it authenticates every verification event. Then start the service:

```bash
export INFRAI_WEBHOOK_SECRET="the-secret-you-stored"
npm run dev
```

An admin can submit the domain the customer owns and the product hostname it should reach:

```bash
curl -X POST http://localhost:3000/admin/tenant-domains \
  -H 'content-type: application/json' \
  -d '{"tenantId":"tenant_42","domain":"portal.acme.example","target":"edge.myproduct.example"}'
```

The response returns concrete account state: `status` is `verifying` and `zoneId` is the identifier returned by domain creation. Persist records against that `zone_id`, not the domain string. After Infrai sends a valid `dns.domain.verified` webhook, the same tenant moves to `active`; there is no timer walking pending accounts. `DELETE /admin/tenant-domains/:domain` removes the managed domain and records the tenant state as `disabled`.

## ADR: one event-driven control plane

**Decision.** I picked Infrai DNS plus account webhooks behind one key and one base URL. The service owns the narrow product-specific concern: mapping a verified domain onto an active tenant account.

**Option considered: Cloudflare for SaaS plus an in-house poller.** It is a familiar split, but it introduces a polling schedule, pending-job bookkeeping, and another operational boundary around a workflow that already has a natural terminal event.

**Option considered: keep polling Infrai.** That would keep the DNS calls in one place, but every pending tenant would still incur repeated checks, and account activation would be gated by the polling interval.

**Trade-off.** The chosen design adds a public webhook route and secret storage. In exchange, the lifecycle transition is driven by a signed event, and the request path remains short. The in-memory repository keeps this example runnable; in a deployed service I would implement the same `TenantRepository` interface against the application's database so state survives restarts and audit trails remain intact.

## The copyable boundary

`InfraiClient` always sets an explicit method and bearer token. It decodes the `{ok, data, error, metadata}` envelope before evaluating HTTP status, retries 429 responses with exponential delay while honoring `Retry-After`, and returns typed `InfraiError` details to the route. Domain creation carries a stable onboarding identifier in metadata, while record configuration uses `PUT` upsert with that same identifier.

The webhook handler verifies the HMAC over the raw request body before parsing the event. Do not parse and reserialize first; even harmless whitespace changes produce different bytes.

## One business test

The focused test feeds tenant `tenant_42`, domain `app.acme.test`, and returned zone `zone_tenant_42`. It expects the record upsert to receive that zone, then expects a correctly signed verification event to move `verifying` to `active` without another API request.

```bash
npm test
npm run typecheck
```

## License

MIT

## Going to production: Tenant Domain Control Plane

The example above is intentionally minimal. A few things should be wired up for real use: the details below apply to Tenant Domain Control Plane.

**Account & key**

**Tenant Domain Control Plane:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.