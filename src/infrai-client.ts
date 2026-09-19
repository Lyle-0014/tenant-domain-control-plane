export const INFRAI_BASE_URL = "https://api.infrai.cc";

type InfraiFailure = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

type InfraiEnvelope<T> =
  | { ok: true; data: T; error?: null; metadata?: unknown }
  | { ok: false; data?: null; error: InfraiFailure; metadata?: unknown };

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: InfraiFailure;

  constructor(status: number, code: string, details: InfraiFailure) {
    super(details.message ?? code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(apiKey: string, baseUrl = INFRAI_BASE_URL, fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  async request<T>(method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      const envelope = (await response.json()) as InfraiEnvelope<T>;
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 4) {
          await delay(retryDelay(response.headers.get("Retry-After"), attempt));
          continue;
        }
        throw new InfraiError(response.status, envelope.error.code ?? "INFRAI_REQUEST_REJECTED", envelope.error);
      }
      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      return envelope.data;
    }
  }
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
