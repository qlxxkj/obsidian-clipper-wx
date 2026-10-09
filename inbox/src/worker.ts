// 极简收件箱(Cloudflare Worker + KV)。
// 职责就三件事:①小程序投待办 ②插件拉待办+ACK ③两层去重。
// 不做抓取/转MD/写库——那些全在本地 Obsidian 插件里。
//
// 路由(全部以 ?code=<6位随机码> 或 Authorization: Bearer <code> 标识设备):
//   POST /v1/claim      小程序投递(绑定码 + 内容)
//   GET  /v1/pending    插件拉取待办
//   POST /v1/ack        插件回写已同步
//   GET  /v1/devices    列出设备(管理用)
//   GET  /              健康检查
//
// KV 布局:
//   dev:<code>                  设备绑定记录
//   q:<code>                   该设备的待办队列(JSON 数组)
//   dedup_url:<sha1(url)>      全局 URL 去重(L1)
//   dedup_content:<code>:<sha1> 按设备内容去重(L2)
//
// 两层去重:
//   L1 全局 URL  —— 同一 url 全站只收一次,防止不同设备重复投同一篇
//   L2 按设备哈希 —— 同设备同内容(即便 url 不同/没 url)不重复

// 去重 TTL:7 天,过期自动放行(避免 KV 无限膨胀)。
const DEDUP_TTL = 7 * 24 * 60 * 60;
// 待办保留:48 小时(过久未 ACK 视为丢弃,防积压)。
const PENDING_TTL = 48 * 60 * 60;
// 单队列上限,防内存/KV 写放大。
const QUEUE_MAX = 200;

export interface ClaimInput {
    url?: string;
    kind?: string; // 'url' | 'text' | 'html' | 'article'
    content?: string; // 纯图文/正文原样存,插件端再决定怎么用
    title?: string;
    tag?: string; // 'clippings' 之类,原样透传
}

export interface InboxItem {
    id: string;
    code: string;
    url?: string;
    kind?: string;
    content?: string;
    title?: string;
    tag?: string;
    at: number; // ms epoch
}

export interface KVBindRecord {
    code: string;
    createdAt: number;
    lastSeen: number;
    note?: string;
}

// 稳定 base64url 编码(不依赖 Node Buffer,适配 CF runtime)。
function toBase64Url(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha1(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-1", data);
    return toBase64Url(new Uint8Array(digest));
}

// ---- 队列读写 ----------------------------------------------------------

async function loadQueue(kv: Env["INBOX"], code: string): Promise<InboxItem[]> {
    const raw = await kv.get(`q:${code}`);
    if (!raw) return [];
    try {
        return JSON.parse(raw) as InboxItem[];
    } catch {
        return [];
    }
}

async function saveQueue(kv: Env["INBOX"], code: string, items: InboxItem[]): Promise<void> {
    await kv.put(`q:${code}`, JSON.stringify(items), {
        expirationTtl: PENDING_TTL,
    });
}

// ---- 去重 --------------------------------------------------------------

async function isUrlSeen(kv: Env["INBOX"], url?: string): Promise<boolean> {
    if (!url) return false;
    const key = `dedup_url:${await sha1(url)}`;
    return !!(await kv.get(key));
}

async function isContentSeen(kv: Env["INBOX"], code: string, content?: string): Promise<boolean> {
    if (!content) return false;
    const key = `dedup_content:${code}:${await sha1(content)}`;
    return !!(await kv.get(key));
}

async function markUrlSeen(kv: Env["INBOX"], url: string): Promise<void> {
    const key = `dedup_url:${await sha1(url)}`;
    await kv.put(key, "1", { expirationTtl: DEDUP_TTL });
}

async function markContentSeen(kv: Env["INBOX"], code: string, content: string): Promise<void> {
    const key = `dedup_content:${code}:${await sha1(content)}`;
    await kv.put(key, "1", { expirationTtl: DEDUP_TTL });
}

// ---- 设备绑定 ----------------------------------------------------------

async function ensureDevice(kv: Env["INBOX"], code: string): Promise<KVBindRecord> {
    const raw = await kv.get(`dev:${code}`);
    if (raw) {
        const rec = JSON.parse(raw) as KVBindRecord;
        rec.lastSeen = Date.now();
        await kv.put(`dev:${code}`, JSON.stringify(rec));
        return rec;
    }
    const rec: KVBindRecord = { code, createdAt: Date.now(), lastSeen: Date.now() };
    await kv.put(`dev:${code}`, JSON.stringify(rec));
    return rec;
}

function extractCode(req: Request): string | null {
    const url = new URL(req.url);
    const q = url.searchParams.get("code");
    if (q) return q;
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer) return bearer;
    return null;
}

function isSixDigit(code: string): boolean {
    return /^\d{6}$/.test(code);
}

// ---- 路由 --------------------------------------------------------------

export default {
    async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
        const url = new URL(req.url);
        const path = url.pathname;

        if (req.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(),
            });
        }

        // 健康检查
        if (path === "/" || path === "/health") {
            return jsonResponse({ app: "wechat-inbox", ok: true, endpoints: ["/v1/claim", "/v1/pending", "/v1/ack", "/v1/devices"] });
        }

        const code = extractCode(req);

        // ---- /v1/claim:小程序投递 --------------------------------------
        if (path === "/v1/claim" && req.method === "POST") {
            if (!code || !isSixDigit(code)) {
                return jsonResponse({ ok: false, error: "missing or invalid ?code=6digits" }, 400);
            }
            let body: ClaimInput;
            try {
                body = await req.json();
            } catch {
                return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
            }
            const norm = normalizeClaim(body);
            // 两层去重:已见过则直接回 ok(不重复入队),让小程序端拿到幂等结果。
            if (await isUrlSeen(env.INBOX, norm.url)) {
                return jsonResponse({ ok: true, deduped: "url", code });
            }
            if (await isContentSeen(env.INBOX, code, norm.content)) {
                return jsonResponse({ ok: true, deduped: "content", code });
            }

            const item: InboxItem = {
                id: await sha1(`${code}:${norm.url || ""}:${norm.content || ""}:${Date.now()}`),
                code,
                ...norm,
                at: Date.now(),
            };
            await ensureDevice(env.INBOX, code);
            const queue = await loadQueue(env.INBOX, code);
            queue.unshift(item); // 新投的放最前,插件按时间从新到旧取
            if (queue.length > QUEUE_MAX) queue.length = QUEUE_MAX;
            await saveQueue(env.INBOX, code, queue);
            // 标记去重键
            if (norm.url) await markUrlSeen(env.INBOX, norm.url);
            if (norm.content) await markContentSeen(env.INBOX, code, norm.content);
            return jsonResponse({ ok: true, id: item.id, queued: queue.length });
        }

        // ---- /v1/pending:插件拉取待办 ----------------------------------
        if (path === "/v1/pending" && req.method === "GET") {
            if (!code || !isSixDigit(code)) {
                return jsonResponse({ ok: false, error: "missing or invalid ?code=6digits" }, 400);
            }
            await ensureDevice(env.INBOX, code);
            const items = await loadQueue(env.INBOX, code);
            // 按游标:客户端带 ?after=<id> 只取比它更旧的(处理顺序),简化用全量 + 客户端本地去重。
            return jsonResponse({ ok: true, items });
        }

        // ---- /v1/ack:插件回写已同步 -----------------------------------
        if (path === "/v1/ack" && req.method === "POST") {
            if (!code || !isSixDigit(code)) {
                return jsonResponse({ ok: false, error: "missing or invalid ?code=6digits" }, 400);
            }
            let body: { ids?: string[]; content?: string; url?: string };
            try {
                body = await req.json();
            } catch {
                return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
            }
            const ids = new Set<string>(body.ids || []);
            const queue = await loadQueue(env.INBOX, code);
            const remaining = queue.filter((i) => !ids.has(i.id));
            const removed = queue.length - remaining.length;
            await saveQueue(env.INBOX, code, remaining);
            // ack 的内容/URL 也顺手标记,防止之后又投重复
            if (body.url) await markUrlSeen(env.INBOX, body.url);
            if (body.content) await markContentSeen(env.INBOX, code, body.content);
            return jsonResponse({ ok: true, removed, remaining: remaining.length });
        }

        // ---- /v1/devices:管理用,列出绑定设备 -------------------------
        if (path === "/v1/devices" && req.method === "GET") {
            // 需要管理 token(简化:仅当 ?admin=<env ADMIN> 匹配才放行,防被枚举)
            const admin = url.searchParams.get("admin");
            if (!env.ADMIN || admin !== env.ADMIN) {
                return jsonResponse({ ok: false, error: "admin token required" }, 403);
            }
            const list: KVBindRecord[] = [];
            // 6 位码数量级很小,单页 list 足够(不跨分页)。
            const page = await env.INBOX.list({ prefix: "dev:", limit: 1000 });
            for (const k of page.keys) {
                const raw = await env.INBOX.get(k.name);
                if (raw) list.push(JSON.parse(raw));
            }
            return jsonResponse({ ok: true, devices: list });
        }

        return jsonResponse({ ok: false, error: "not found" }, 404);
    },
};

// ---- 工具 --------------------------------------------------------------

function normalizeClaim(body: ClaimInput) {
    return {
        url: body.url?.trim() || undefined,
        kind: body.kind || "url",
        content: body.content?.trim() || undefined,
        title: body.title?.trim() || undefined,
        tag: body.tag?.trim() || "clippings",
    };
}

function jsonResponse(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
    });
}

function corsHeaders() {
    return {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "GET, POST, OPTIONS",
    };
}
