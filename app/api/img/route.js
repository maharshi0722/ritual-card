export const runtime = "nodejs";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  if (!url) {
    return new Response("Missing url param", { status: 400 });
  }

  // Basic allowlist to reduce SSRF risk (add/remove as needed)
  const allowedHosts = new Set([
    "pbs.twimg.com",
    "abs.twimg.com",
    "twimg.com",
    "video.twimg.com",
    "ton.twimg.com",
  ]);

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  const isAllowed =
    allowedHosts.has(host) || Array.from(allowedHosts).some((h) => host === h || host.endsWith(`.${h}`));

  if (!isAllowed) {
    return new Response("Host not allowed", { status: 403 });
  }

  try {
    const upstream = await fetch(url, {
      // Some upstreams block requests without UA
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; RitualCardBot/1.0)",
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await upstream.arrayBuffer();

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "content-type": contentType,
        // Cache a bit to speed up repeats
        "cache-control": "public, max-age=3600, s-maxage=3600",
        // IMPORTANT for html-to-image: allow browser to use it as same-origin
        "access-control-allow-origin": "*",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("Proxy failed", { status: 500 });
  }
}