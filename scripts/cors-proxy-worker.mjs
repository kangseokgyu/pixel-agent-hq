const NOTION_API_ROOT = "https://api.notion.com/v1";
const ALLOWED_QUERY_PATH = /^\/v1\/data_sources\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/query$/i;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/;
const MAX_BODY_BYTES = 4096;
const ALLOWED_BODY_KEYS = new Set(["page_size", "start_cursor", "filter", "sorts"]);
const UPSTREAM_TIMEOUT_MS = 15_000;
const utf8Encoder = new TextEncoder();

function parseAllowedOrigins(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const origins = new Set();
  for (const entry of list) {
    const trimmed = String(entry || "").trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Ignore invalid origin entries.
    }
  }
  return origins;
}

function baseHeaders(origin) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonError(status, message, origin = null, extraHeaders = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...baseHeaders(origin),
      ...extraHeaders,
    },
  });
}

export async function handleCorsProxyRequest(
  request,
  { allowedOrigins = [], notionApiRoot = NOTION_API_ROOT, fetchImpl = globalThis.fetch } = {},
) {
  const allowedSet = parseAllowedOrigins(allowedOrigins);
  const originHeader = request.headers.get("Origin");
  if (!originHeader || !allowedSet.has(originHeader)) {
    return jsonError(403, "Origin not allowed.");
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...baseHeaders(originHeader),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Notion-Version",
        "Access-Control-Max-Age": "600",
      },
    });
  }

  if (request.method !== "POST") {
    return jsonError(405, "Only POST and OPTIONS are allowed.", originHeader, {
      Allow: "POST, OPTIONS",
    });
  }

  const url = new URL(request.url);
  const pathMatch = url.pathname.match(ALLOWED_QUERY_PATH);
  if (!pathMatch) {
    return jsonError(403, "Only POST /v1/data_sources/{uuid}/query is permitted.", originHeader);
  }

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ") || authorization.length <= 7 || CONTROL_PATTERN.test(authorization)) {
    return jsonError(401, "Missing or invalid Authorization bearer header.", originHeader);
  }

  const notionVersion = request.headers.get("Notion-Version") || "2026-03-11";
  if (CONTROL_PATTERN.test(notionVersion)) {
    return jsonError(400, "Invalid Notion-Version header.", originHeader);
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonError(413, "Request body exceeds maximum allowed size.", originHeader);
  }

  const upstreamUrl = `${notionApiRoot.replace(/\/$/, "")}/data_sources/${encodeURIComponent(pathMatch[1])}/query`;
  const requestBody = await request.text();
  if (utf8Encoder.encode(requestBody).length > MAX_BODY_BYTES) {
    return jsonError(413, "Request body exceeds maximum allowed size.", originHeader);
  }

  let forwardBody = "{}";
  const trimmedBody = requestBody.trim();
  if (trimmedBody.length > 0) {
    let parsedBody;
    try {
      parsedBody = JSON.parse(trimmedBody);
    } catch {
      return jsonError(400, "Invalid JSON request body.", originHeader);
    }
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return jsonError(400, "Request body must be a JSON object.", originHeader);
    }
    for (const key of Object.keys(parsedBody)) {
      if (!ALLOWED_BODY_KEYS.has(key)) {
        return jsonError(400, `Unsupported query field: ${key}`, originHeader);
      }
    }
    forwardBody = JSON.stringify(parsedBody);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstreamResponse;
  try {
    upstreamResponse = await fetchImpl(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        "Notion-Version": notionVersion,
      },
      body: forwardBody,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const responseHeaders = new Headers({
    ...baseHeaders(originHeader),
    "Content-Type": upstreamResponse.headers.get("Content-Type") || "application/json; charset=utf-8",
    "Access-Control-Expose-Headers": "Retry-After",
  });
  const retryAfter = upstreamResponse.headers.get("Retry-After");
  if (retryAfter) {
    responseHeaders.set("Retry-After", retryAfter);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export default {
  fetch(request, env = {}) {
    return handleCorsProxyRequest(request, {
      allowedOrigins: env.ALLOWED_ORIGINS,
      notionApiRoot: env.NOTION_API_ROOT || NOTION_API_ROOT,
    });
  },
};
