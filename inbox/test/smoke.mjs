// 本地冒烟测试:用内存 KV 打 worker 的 fetch,验证
// claim → pending → 去重(L1 url / L2 content)→ ack → pending 空 的闭环。
import worker from "../src/worker.ts";

// --- 内存 KV 替身 ---
class MemoryKV {
    constructor() {
        this.map = new Map();
    }
    async get(k) {
        return this.map.get(k) ?? null;
    }
    async put(k, v) {
        this.map.set(k, v);
    }
    async list({ prefix, limit } = {}) {
        const keys = [...this.map.keys()]
            .filter((k) => (!prefix || k.startsWith(prefix)) && (!limit || true))
            .map((name) => ({ name }));
        return { keys, list_complete: true };
    }
}

const env = { INBOX: new MemoryKV() };
const mk = (path, init = {}) => new Request(`https://inbox.local${path}`, init);
const ok = async (r) => JSON.parse(await r.text());

function ctx() {
    return { waitUntil: () => {}, async: () => {}, done: new Promise(() => {}), log: () => {} };
}

let pass = 0,
    fail = 0;
function check(name, cond, extra = "") {
    if (cond) {
        pass++;
        console.log(`  ok   ${name}`);
    } else {
        fail++;
        console.log(`  FAIL ${name} ${extra}`);
    }
}

// 1. 投一个 url
let r = await ok(await worker.fetch(mk("/v1/claim?code=123456", { method: "POST", body: JSON.stringify({ url: "https://a.com/x" }) }), env, ctx()));
check("claim url → ok+id", r.ok === true && !!r.id && !r.deduped, JSON.stringify(r));

// 2. 再投同一 url → L1 去重
r = await ok(await worker.fetch(mk("/v1/claim?code=123456", { method: "POST", body: JSON.stringify({ url: "https://a.com/x" }) }), env, ctx()));
check("重复 url → deduped:url", r.deduped === "url", JSON.stringify(r));

// 3. 投一个 content(无 url)→ L2 去重
r = await ok(await worker.fetch(mk("/v1/claim?code=123456", { method: "POST", body: JSON.stringify({ kind: "text", content: "hello world" }) }), env, ctx()));
check("claim text → ok", r.ok === true, JSON.stringify(r));
r = await ok(await worker.fetch(mk("/v1/claim?code=123456", { method: "POST", body: JSON.stringify({ kind: "text", content: "hello world" }) }), env, ctx()));
check("重复 content → deduped:content", r.deduped === "content", JSON.stringify(r));

// 4. pending 应含 2 条(去重后只入队了不同的)
r = await ok(await worker.fetch(mk("/v1/pending?code=123456"), env, ctx()));
check("pending 有 2 条", r.items?.length === 2, `got ${r.items?.length}`);

// 5. 不同设备的码,同 url 仍会入队(L1 是全局 url 去重 → 实际被拦)
r = await ok(await worker.fetch(mk("/v1/claim?code=654321", { method: "POST", body: JSON.stringify({ url: "https://a.com/x" }) }), env, ctx()));
check("跨设备同 url → 仍被 L1 拦(deduped:url)", r.deduped === "url", JSON.stringify(r));

// 6. ack 清掉 123456 的待办
const ids = (await ok(await worker.fetch(mk("/v1/pending?code=123456"), env, ctx()))).items.map((i) => i.id);
r = await ok(await worker.fetch(mk("/v1/ack?code=123456", { method: "POST", body: JSON.stringify({ ids }) }), env, ctx()));
check("ack 清 2 条", r.remaining === 0, JSON.stringify(r));
r = await ok(await worker.fetch(mk("/v1/pending?code=123456"), env, ctx()));
check("ack 后 pending 空", r.items?.length === 0, `got ${r.items?.length}`);

// 7. 非法码被拒
r = await ok(await worker.fetch(mk("/v1/claim?code=abc", { method: "POST", body: JSON.stringify({ url: "https://a.com/x" }) }), env, ctx()));
check("非 6 位数字码 → 400 语义", r.ok === false, JSON.stringify(r));

// 8. 健康检查
r = await ok(await worker.fetch(mk("/health"), env, ctx()));
check("health ok", r.ok === true, JSON.stringify(r));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
