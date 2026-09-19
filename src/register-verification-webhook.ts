import { randomBytes } from "node:crypto";
import { InfraiClient } from "./infrai-client.js";

const apiKey = process.env.INFRAI_API_KEY;
const webhookUrl = process.env.WEBHOOK_URL;
if (!apiKey || !webhookUrl) throw new Error("INFRAI_API_KEY and WEBHOOK_URL are required");

const secret = process.env.INFRAI_WEBHOOK_SECRET ?? randomBytes(32).toString("hex");
const infrai = new InfraiClient(apiKey);
const webhook = await infrai.request<{ id: string }>("POST", "/v1/account/webhooks/register", {
  url: webhookUrl,
  events: ["dns.domain.verified"],
  description: "Activate tenant domains after DNS verification",
  secret,
  headers: { "x-registration-purpose": "tenant-domain-verification" },
});

console.log(JSON.stringify({ webhook_id: webhook.id, secret }, null, 2));
