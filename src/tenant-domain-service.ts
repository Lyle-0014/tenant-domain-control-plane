import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { InfraiClient } from "./infrai-client.js";

export const onboardingBody = z.object({
  tenantId: z.string().min(1),
  domain: z.string().min(3).regex(/^[a-z0-9.-]+$/),
  target: z.string().min(3),
});

export type OnboardingInput = z.infer<typeof onboardingBody>;
export type TenantDomain = OnboardingInput & {
  zoneId: string;
  status: "verifying" | "active" | "disabled";
};

type AddedDomain = { zone_id: string };

export interface TenantRepository {
  save(tenant: TenantDomain): Promise<void>;
  findByDomain(domain: string): Promise<TenantDomain | undefined>;
}

export class MemoryTenantRepository implements TenantRepository {
  private readonly tenants = new Map<string, TenantDomain>();
  async save(tenant: TenantDomain): Promise<void> { this.tenants.set(tenant.domain, tenant); }
  async findByDomain(domain: string): Promise<TenantDomain | undefined> { return this.tenants.get(domain); }
}

export class TenantDomainService {
  private readonly infrai: InfraiClient;
  private readonly tenants: TenantRepository;

  constructor(infrai: InfraiClient, tenants: TenantRepository) {
    this.infrai = infrai;
    this.tenants = tenants;
  }

  async onboard(input: OnboardingInput): Promise<TenantDomain> {
    const requestId = `tenant-domain:${input.tenantId}:${input.domain}`;
    const domain = await this.infrai.request<AddedDomain>("POST", "/v1/dns/domain/add", {
      domain: input.domain,
      account_id: input.tenantId,
      metadata: { onboarding_id: requestId },
    });
    await this.infrai.request("PUT", "/v1/dns/record/upsert", {
      zone_id: domain.zone_id,
      record_type: "CNAME",
      name: input.domain,
      content: input.target,
      ttl: 300,
      proxied: true,
      metadata: { onboarding_id: requestId },
    });
    await this.infrai.request("POST", "/v1/dns/domain/verify", { domain: input.domain });

    const tenant: TenantDomain = { ...input, zoneId: domain.zone_id, status: "verifying" };
    await this.tenants.save(tenant);
    return tenant;
  }

  async acceptVerifiedDomain(domain: string): Promise<TenantDomain | undefined> {
    const tenant = await this.tenants.findByDomain(domain);
    if (!tenant || tenant.status !== "verifying") return tenant;
    const active = { ...tenant, status: "active" as const };
    await this.tenants.save(active);
    return active;
  }

  async disable(domain: string): Promise<TenantDomain | undefined> {
    const tenant = await this.tenants.findByDomain(domain);
    if (!tenant) return undefined;
    await this.infrai.request("DELETE", `/v1/dns/domain/delete?domain=${encodeURIComponent(domain)}`);
    const disabled = { ...tenant, status: "disabled" as const };
    await this.tenants.save(disabled);
    return disabled;
  }
}

export const verificationEvent = z.object({
  event: z.literal("dns.domain.verified"),
  data: z.object({ domain: z.string().min(3) }),
});

export function verifyWebhook(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = signature.replace(/^sha256=/, "");
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
