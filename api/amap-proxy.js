const ALLOWED_PATH = /^(?:v3|v4|v5)\/[A-Za-z0-9_./-]+$/;

export default {
  async fetch(request) {
    if (!isSameOriginRequest(request)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const securityCode = process.env.AMAP_SECURITY_JS_CODE;
    if (!securityCode) {
      return Response.json({ error: "AMap proxy is not configured" }, { status: 503 });
    }

    const requestUrl = new URL(request.url);
    const upstreamPath = requestUrl.searchParams.get("path") || "";
    if (!ALLOWED_PATH.test(upstreamPath) || upstreamPath.includes("..")) {
      return Response.json({ error: "Unsupported AMap path" }, { status: 400 });
    }

    const upstreamUrl = new URL(`https://restapi.amap.com/${upstreamPath}`);
    requestUrl.searchParams.delete("path");
    requestUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.append(key, value));
    upstreamUrl.searchParams.set("jscode", securityCode);

    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    const method = request.method.toUpperCase();
    if (!["GET", "POST"].includes(method)) {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers,
      body: method === "POST" ? await request.arrayBuffer() : undefined
    });

    const responseHeaders = new Headers();
    responseHeaders.set("content-type", upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8");
    responseHeaders.set("cache-control", "no-store");
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders
    });
  }
};

function isSameOriginRequest(request) {
  const requestUrl = new URL(request.url);
  const source = request.headers.get("origin") || request.headers.get("referer");
  if (!source) return false;

  try {
    return new URL(source).host === requestUrl.host;
  } catch {
    return false;
  }
}
