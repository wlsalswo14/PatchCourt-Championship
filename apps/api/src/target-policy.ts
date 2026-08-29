import { ContractError } from "@patchcourt/core";

const DEFAULT_OWNED_LOOPBACK_ORIGINS = ["http://127.0.0.1:4173", "http://localhost:4173"];

function configuredOrigins(additional: Iterable<string>): Set<string> {
  const values = (process.env.PATCHCOURT_OWNED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_OWNED_LOOPBACK_ORIGINS, ...values, ...additional].map((value) => new URL(value).origin));
}

export class TargetPolicy {
  readonly #ownedOrigins: Set<string>;

  constructor(additionalOwnedOrigins: Iterable<string> = []) {
    this.#ownedOrigins = configuredOrigins(additionalOwnedOrigins);
  }

  assertAllowed(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ContractError("target must be an absolute owned URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new ContractError("target protocol is not allowed");
    if (url.username || url.password) throw new ContractError("target credentials are forbidden");
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    const rawAuthority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i)?.[1] ?? "";
    const rawHost = rawAuthority.replace(/^.*@/, "").replace(/:\d+$/, "").toLowerCase();
    if (loopback && !["127.0.0.1", "localhost", "[::1]"].includes(rawHost)) {
      throw new ContractError("alternate or encoded loopback host syntax is forbidden");
    }
    const remoteExplicitlyEnabled = process.env.PATCHCOURT_ALLOW_OWNED_REMOTE === "true";
    if (loopback && !this.#ownedOrigins.has(url.origin)) {
      throw new ContractError("loopback origin is not in the explicit owned fixture allowlist");
    }
    if (!loopback && (!remoteExplicitlyEnabled || !this.#ownedOrigins.has(url.origin))) {
      throw new ContractError("championship execution is restricted to the owned synthetic loopback fixture");
    }
    for (const key of url.searchParams.keys()) {
      if (/(?:key|token|secret|auth|signature|cookie)/i.test(key)) throw new ContractError("credential-like target query parameter is forbidden");
    }
    return url;
  }

  isLoopback(value: string): boolean {
    const url = this.assertAllowed(value);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  }
}
