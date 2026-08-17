export default {
  fetch(request) {
    const jsApiKey = process.env.AMAP_JS_API_KEY;
    if (!jsApiKey) {
      return Response.json(
        { error: "AMap deployment configuration is missing" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    const origin = new URL(request.url).origin;
    return Response.json(
      {
        jsApiKey,
        serviceHost: `${origin}/_AMapService`
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
};
