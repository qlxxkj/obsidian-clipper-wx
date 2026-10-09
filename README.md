# obsidian-clipper-wx

把 **Obsidian Web Clipper** 移植成**微信小程序 + 桌面 Obsidian 插件**的独立项目。

核心思路(对齐 `less1001/obsync`、`mingjuner123-spec/wechat-inbox-sync` 这类"微信→Obsidian 同步"插件,但**重活尽量塞进 Obsidian 插件本地做**):

- **小程序是薄客户端**:只做"投链接/图文 + 输 6 位设备码"。
- **转换/写库全在桌面 Obsidian 插件本地**:抓活网页 → Defuddle 抽正文 → Markdown + frontmatter → 去重写进 vault。
- **中间只留一个极薄的 Cloudflare Worker 收件箱**(存待办 + 两层去重 + ACK)。没有用户体系、没有 AI、没有洗稿,就一个待办队列。

## 三块

| 目录 | 角色 | 关键点 |
|---|---|---|
| `inbox/` | Cloudflare Worker + KV 收件箱 | `POST /v1/claim`(投)、`GET /v1/pending`(拉)、`POST /v1/ack`(清)、`GET /v1/devices`(管理)。两层去重:全局 URL + 按设备内容哈希 |
| `obsidian-plugin/` | 桌面 Obsidian 插件 | poll 收件箱 → **本地** Defuddle 转换 + 图片本地化 + 去重 → `app.vault.create` 写库 → ack |
| `miniapp/` | 微信小程序 | 只 `POST /v1/claim` 投待办,输 6 位码绑定设备;不预览不转换 |

## 数据流

```
小程序(投 链接/图文 + 6位码)
   │  POST /v1/claim?code=xxxxxx   (只存一条待办,不转换)
   ▼
Cloudflare Worker + KV(收件箱,两层去重:全局 URL + 按设备内容哈希)
   │  GET /v1/pending?code=  桌面插件 poll(默认 5 分钟一次)
   ▼
桌面 Obsidian 插件(本地抓活网页 + Defuddle 转 MD + 图片本地化 + 去重)
   │  POST /v1/ack{ids}  写完回 ACK,收件箱清掉
   ▼
本地 vault(.md 落到 Clippings/)
```

## 为什么"几乎无后端"

手机(小程序)和电脑(Obsidian)是两台机器,中间必须有**共同收件箱**当邮筒。这个邮筒我们压到最薄:一个无状态 Worker + KV,**零业务逻辑**。抓取/转 MD/反爬/写库全在本地插件,所以你不需要自托管任何"转换服务",只部署一个免费额度的 Cloudflare Worker。

## 快速开始

```bash
# 1) 部署收件箱(需 Cloudflare 账号 + wrangler 登录)
cd inbox && npm install
npx wrangler kv:namespace create INBOX        # 把返回的 id 填进 wrangler.toml
npx wrangler deploy                             # 得到 https://...workers.dev

# 2) 桌面插件
cd obsidian-plugin && npm install && npm run build
# 把 main.js + manifest.json 拷进  <你的vault>/.obsidian/plugins/wechat-inbox-sync/
# Obsidian 设置里填 收件箱地址 + 点「生成」拿 6 位码

# 3) 小程序
微信开发者工具导入 miniapp/;设置页填 收件箱 Worker 地址 + 同一个 6 位码
```

详见各子目录 README。

## 两层去重(你问的"查重")

1. **L1 全局 URL**:同一 url 全站只收一次(防不同设备重复投同一篇)。KV 键 `dedup_url:<sha1(url)>`,TTL 7 天。
2. **L2 按设备内容哈希**:同设备同内容(即便 url 不同或没 url)不重复。KV 键 `dedup_content:<code>:<sha1(content)>`,TTL 7 天。
3. 插件端再补一层**本地内容缓存 + 文件存在性**(不覆盖已存在文件),防 KV 去重键过期后重投。
