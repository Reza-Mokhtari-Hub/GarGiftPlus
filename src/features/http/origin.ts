/**
 * Stable origin for absolute URLs embedded in public, shared responses.
 * A configured value is deployment policy, so fail closed on malformed input
 * instead of silently putting a request-derived hostname into the shared cache.
 */
export function publicOrigin(
  requestOrigin: string,
  configuredOrigin: string | undefined,
): string {
  if (configuredOrigin === undefined) return new URL(requestOrigin).origin;

  const value = configuredOrigin.trim();
  if (!value) throw new Error('CANONICAL_ORIGIN must not be empty');

  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('CANONICAL_ORIGIN must be an HTTPS origin without a path');
  }
  return url.origin;
}

const VALID_PROTO_RE = /^https?$/i;
const SAFE_HOST_RE = /^[a-z0-9.-]+(?::\d{1,5})?$|^\[[0-9a-f:]+\](?::\d{1,5})?$/i;

/**
 * Safely apply reverse-proxy X-Forwarded-Proto and X-Forwarded-Host headers
 * without ever trusting malformed host/scheme payloads or throwing on parse.
 */
export function resolveEffectiveRequestUrl(url: URL, headers: Headers): URL {
  const effectiveUrl = new URL(url);
  const rawProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  let protoValid = true;
  if (rawProto) {
    const cleanProto = rawProto.replace(/:$/, '').toLowerCase();
    if (VALID_PROTO_RE.test(cleanProto)) {
      effectiveUrl.protocol = `${cleanProto}:`;
    } else {
      protoValid = false;
    }
  }

  if (!protoValid) return effectiveUrl;

  const rawHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (rawHost && SAFE_HOST_RE.test(rawHost)) {
    try {
      const parsed = new URL(`${effectiveUrl.protocol}//${rawHost}`);
      if (
        !parsed.username &&
        !parsed.password &&
        parsed.pathname === '/' &&
        parsed.host.toLowerCase() === rawHost.toLowerCase()
      ) {
        effectiveUrl.hostname = parsed.hostname;
        effectiveUrl.port = parsed.port;
      }
    } catch {
      // Ignore malformed forwarded host values cleanly.
    }
  }
  return effectiveUrl;
}

/**
 * Detect whether the client-facing connection is HTTPS (either directly or via
 * a validated X-Forwarded-Proto header from Cloudflare / preview proxy).
 */
export function isSecureRequest(request: Request, url: URL): boolean {
  if (url.protocol === 'https:') return true;
  const fwdProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return fwdProto === 'https';
}

/**
 * Resolve callback origin for external payment gateways. Uses CANONICAL_ORIGIN
 * in live environments while preserving loopback origins for local/Wrangler tests.
 */
export function gatewayCallbackOrigin(
  url: URL,
  configuredOrigin: string | undefined,
): string {
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    return url.origin;
  }
  if (!configuredOrigin?.trim()) return url.origin;
  return publicOrigin(url.origin, configuredOrigin);
}

