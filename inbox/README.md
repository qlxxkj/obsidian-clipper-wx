# inbox(Cloudflare Worker + KV 收件箱)

极简、无业务逻辑的"邮筒"。小程序往里投待办,桌面 Obsidian 插件从里拉、写完回 ACK。它**不抓取、不转 MD**——那些在 `../obsidian-plugin` 本地做。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/claim?code=xxxxxx` | 小程序投递。body `{ url?, kind?, content?, title?, tag? }`。返回 `{ ok, id?, deduped?, queued? }` |
| GET | `/v1/pending?code=xxxxxx` | 桌面插件拉待办。返回 `{ ok, items: InboxItem[] }` |
| POST | `/v1/ack?code=xxxxxx` | 桌面插件回写已同步。body `{ ids, url?, content? }`。返回 `{ ok, removed, remaining }` |
| GET | `/v1/devices?admin=<token>` | 管理:列出绑定设备(需 `wrangler secret put ADMIN`) |
| GET | `/health` | 连通性检测 |

`code` 是 6 位数字设备码,走 `?code=` 或 `Authorization: Bearer <code>`。

## 两层去重

- **L1 全局 URL** `dedup_url:<sha1(url)>` —— 同 url 全站只收一次,防不同设备重复投。
- **L2 按设备内容** `dedup_content:<code>:<sha1(content)>` —— 同设备同内容不重复。

两者 TTL 7 天;待办队列 TTL 48 小时(过久未 ACK 自动丢弃,防积压)。

## 部署

```bash
cd inbox && npm install
npx wrangler kv:namespace create INBOX
# 把打印的 namespace id 填进 wrangler.toml 的 <YOUR_KV_ID>
npx wrangler deploy
# 可选:开管理接口
npx wrangler secret put ADMIN
```

本地开发:`npx wrangler dev`(自带内存 KV)。

冒烟测试(验证 claim→pending→去重→ack 闭环,内存 KV,无需部署):

```bash
npx tsx test/smoke.mjs
```

## 关键取舍

- **无鉴权体系**:身份就是 6 位码。够用于个人/小团队;生产建议给 Worker 套一层 Cloudflare Access 或 IP 白名单,并务必设 `ADMIN` 防 `/v1/devices` 被枚举。
- **纯队列,不存正文内容库**:内容只在待办窗口(48h)里;真正持久化的 `.md` 在用户 vault 里。收件箱是"临时邮筒",对齐 obsync 的 transient-buffer 语义。
