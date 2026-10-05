// This is a browser request boundary, not account authentication.
// Forwarded headers are deliberately not trusted to select an origin or host.
export function createPrivateRequestGuard(value = "") {
  const allowedOrigins = new Set();
  const allowedHosts = new Set();
  for (const entry of value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const origin = new URL(entry);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== entry
    )
      throw new Error(
        "PRIVATE_ALLOWED_ORIGINS에는 경로 없는 HTTP(S) 출처를 넣어 주세요.",
      );
    allowedOrigins.add(origin.origin);
    allowedHosts.add(origin.host);
  }
  return (request) => {
    const authority = request.headers.host;
    if (typeof authority !== "string" || /[\s/@?#,\\]/.test(authority))
      return false;
    let target;
    try {
      target = new URL("http://" + authority);
    } catch {
      return false;
    }
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
      !allowedHosts.has(target.host)
    )
      return false;
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const origin = request.headers.origin;
    const site = request.headers["sec-fetch-site"];
    if (site === "cross-site") return false;
    if (origin !== undefined)
      return origin === target.origin || allowedOrigins.has(origin);
    // Browser same-site requests from a different port are not same-origin.
    // Headerless CLI clients keep their existing access within the private network boundary.
    return site === undefined || site === "same-origin" || site === "none";
  };
}
