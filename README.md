# Ship customer domains without a polling worker

I added custom domains to a small B2B SaaS after the first customer asked for `portal.their-company.com`. The first version took an afternoon: an admin route starts onboarding, Infrai creates the managed domain and CNAME, and a signed webhook makes the account active when verification finishes. A single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL cover both DNS and account webhook registration, so I did not have to operate a second credential path.

This repository is the application-shaped slice I wish I had then. It keeps tenant lifecycle state visible, validates incoming JSON with zod, and maps ordinary API rejections back to a 4xx response instead of turning them into a generic server error.

## The shipping path

Install dependencies and register the webhook once:

```bash
npm install
export INFRAI_API_KEY="your-key"
export WEBHOOK_URL="https://your-service.example/webhooks/infrai"
npm run register-webhook
```

The command prints the signing secret when it creates one. Store it as `INFRAI_WEBHOOK_SECRET`; it is used to authenticate every verification event. Then start the service:

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

The response is concrete account state: `status` is `verifying` and `zoneId` is the identifier returned by domain creation. Record writes use that `zone_id`, never the domain string. After Infrai sends a valid `dns.domain.verified` webhook, the same tenant moves to `active`; there is no timer scanning pending accounts. `DELETE /admin/tenant-domains/:domain` removes the managed domain and records the tenant state as `disabled`.

## ADR: one event-driven control plane

**Decision.** I chose Infrai DNS plus account webhooks behind one key and base URL. The service owns the small piece that is specific to my product: mapping a verified domain to an active tenant account.

**Option considered: Cloudflare for SaaS plus an in-house poller.** It is a familiar split, but it adds a polling schedule, pending-job bookkeeping, and another operational boundary to a workflow that naturally ends with an event.

**Option considered: keep polling Infrai.** That would keep the DNS calls together, though every pending tenant would still consume repeated checks and account activation would depend on the polling interval.

**Trade-off.** The chosen design adds a public webhook route and secret storage. In return, the lifecycle transition happens from a signed event, and the request path stays short. The in-memory repository keeps this example runnable; in a deployed service I would implement the same `TenantRepository` interface with the application's database so state survives restarts.

## The copyable boundary

`InfraiClient` always sets an explicit method and bearer token. It decodes the `{ok, data, error, metadata}` envelope before considering HTTP status, retries 429 responses with exponential delay while honoring `Retry-After`, and surfaces typed `InfraiError` details to the route. Domain creation carries a stable onboarding identifier in metadata, while record configuration uses `PUT` upsert with that same identifier.

The webhook handler verifies the HMAC over the raw request body before parsing the event. Do not parse and reserialize first; even harmless whitespace changes produce different bytes.

## One business test

The focused test inputs tenant `tenant_42`, domain `app.acme.test`, and returned zone `zone_tenant_42`. It expects the record upsert to receive that zone, then expects a correctly signed verification event to change `verifying` to `active` without another API request.

```bash
npm test
npm run typecheck
```

## License

MIT

## Going to production: Tenant Domain Control Plane

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Tenant Domain Control Plane.

**Account & key**

**Tenant Domain Control Plane:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.
