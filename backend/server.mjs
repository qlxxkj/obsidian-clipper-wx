#!/usr/bin/env node
import { createServer } from "node:http";

import { clipUrl, clipPure } from "./clipper-service.mjs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || "127.0.0.1";
// Shared token the Mini Program must send as `x-clipper-token` (or `Authorization: Bearer`).
// Keep it empty to disable auth (local/dev only).
const TOKEN = process.env.CLIPPER_TOKEN || "";
// Allow-list of domains the /clip endpoint may fetch. Empty = allow all (dev).
// For a public deployment, set CLIPPER_ALLOWED_DOMAINS="example.com,example.org".
const ALLOWED_DOMAINS = (process.env.CLIPPER_ALLOWED_DOMAINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function hostOf(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return "";
    }
}

function domainAllowed(url) {
    if (ALLOWED_DOMAINS.length === 0) return true;
    const host = hostOf(url);
    return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (c) => {
            size += c.length;
            if (size > 2_000_000) {
                reject(new Error("body too large"));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

function sendJson(res, status, payload) {
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": process.env.CLIPPER_ALLOW_ORIGIN || "*",
        "access-control-allow-headers": "content-type, x-clipper-token, authorization",
        "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    res.end(JSON.stringify(payload));
}

function authorized(req) {
    if (!TOKEN) return true;
    const headerToken = req.headers["x-clipper-token"];
    const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
    return headerToken === TOKEN || bearer === TOKEN;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
async function handleClip(req, res) {
    const body = JSON.parse(await readBody(req) || "{}");
    const url = String(body.url || "").trim();
    if (!url) return sendJson(res, 400, { error: "`url` is required" });
    if (!/^https?:\/\//i.test(url)) return sendJson(res, 400, { error: "url must be http(s)" });
    if (!domainAllowed(url)) return sendJson(res, 403, { error: `domain not allowed: ${hostOf(url)}` });

    const startedAt = Date.now();
    try {
        const result = await clipUrl(url, {
            tags: Array.isArray(body.tags) ? body.tags : undefined,
            template: typeof body.template === "string" && body.template ? body.template : undefined,
            selector: typeof body.selector === "string" ? body.selector : undefined,
            language: typeof body.language === "string" ? body.language : undefined,
        });
        console.log(`${new Date().toLocaleTimeString()} POST /clip ${url} -> 200 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
        return sendJson(res, 200, {
            markdown: result.markdown,
            content: result.content,
            contentHtml: result.contentHtml,
            meta: result.meta,
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.log(`${new Date().toLocaleTimeString()} POST /clip ${url} -> failed (${reason})`);
        return sendJson(res, 502, { error: reason });
    }
}

async function handlePure(req, res) {
    const body = JSON.parse(await readBody(req) || "{}");
    const result = clipPure({
        content: body.content,
        title: body.title,
        url: body.url,
        description: body.description,
        tags: Array.isArray(body.tags) ? body.tags : undefined,
        frontmatter: body.frontmatter,
        template: typeof body.template === "string" && body.template ? body.template : undefined,
    });
    console.log(`${new Date().toLocaleTimeString()} POST /clip/pure -> 200 (${String(result.content).length} chars)`);
    return sendJson(res, 200, result);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
    try {
        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "access-control-allow-origin": process.env.CLIPPER_ALLOW_ORIGIN || "*",
                "access-control-allow-headers": "content-type, x-clipper-token, authorization",
                "access-control-allow-methods": "GET, POST, OPTIONS",
            });
            return res.end();
        }

        if (!authorized(req)) {
            return sendJson(res, 401, { error: "invalid or missing token" });
        }

        const path = (req.url || "/").split("?")[0];
        if (path === "/clip" && req.method === "POST") {
            return await handleClip(req, res);
        }
        if (path === "/clip/pure" && req.method === "POST") {
            return await handlePure(req, res);
        }
        if (path === "/" || path === "/health") {
            return sendJson(res, 200, { app: "clipper-backend", ok: true, endpoints: ["POST /clip", "POST /clip/pure"] });
        }
        return sendJson(res, 404, { error: "not found", usage: "POST /clip {url,...} | POST /clip/pure {content,...}" });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) sendJson(res, 500, { error: reason });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`clipper-backend listening on http://${HOST}:${PORT}`);
    console.log(`  POST /clip       { url, tags?, template?, selector?, language? }  -> { markdown, content, meta }`);
    console.log(`  POST /clip/pure  { content, title?, url?, tags?, frontmatter? }    -> { markdown }`);
    if (TOKEN) console.log("  Auth: enabled (CLIPPER_TOKEN set)");
    if (ALLOWED_DOMAINS.length) console.log(`  Allowed domains: ${ALLOWED_DOMAINS.join(", ")}`);
});
