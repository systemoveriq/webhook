// Cloudflare Worker: catches any request sent to /h/<uuid> and stores it in KV.
// Setup: create a KV namespace, bind it as HOOKS, deploy this file.
const TTL = 60 * 60 * 24 * 7; // keep requests 7 days
const MAX_BODY = 256 * 1024;
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,DELETE,OPTIONS",
  "access-control-allow-headers": "*",
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...cors } });
const validToken = (t) => /^[0-9a-f-]{36}$/.test(t || "");

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // Inspector API
    if (parts[0] === "api" && validToken(parts[1])) {
      if (req.method === "OPTIONS") return new Response(null, { headers: cors });
      const prefix = `r:${parts[1]}:`;
      if (req.method === "DELETE") {
        const { keys } = await env.HOOKS.list({ prefix });
        await Promise.all(keys.map((k) => env.HOOKS.delete(k.name)));
        return json({ cleared: keys.length });
      }
      const { keys } = await env.HOOKS.list({ prefix, limit: 100 });
      const items = await Promise.all(keys.map((k) => env.HOOKS.get(k.name, "json")));
      return json(items.filter(Boolean).sort((a, b) => b.time - a.time));
    }

    // Capture endpoint (any method)
    if (parts[0] === "h" && validToken(parts[1])) {
      const raw = await req.arrayBuffer();
      const body = new TextDecoder().decode(raw.slice(0, MAX_BODY));
      const time = Date.now();
      const id = `${time}-${Math.random().toString(36).slice(2, 8)}`;
      const record = {
        id,
        time,
        method: req.method,
        url: req.url,
        path: "/" + parts.slice(2).join("/"),
        query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(req.headers),
        ip: req.headers.get("cf-connecting-ip"),
        size: raw.byteLength,
        body,
      };
      await env.HOOKS.put(`r:${parts[1]}:${id}`, JSON.stringify(record), { expirationTtl: TTL });
      return new Response("OK", { status: 200, headers: cors });
    }

    return new Response("Not found", { status: 404 });
  },
};
