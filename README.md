# wechat-clipper-wx(小程序 + 收件箱 Worker)

把 **Obsidian Web Clipper** 移植成「微信小程序 + 自建收件箱 + 桌面 Obsidian 插件」的三件套。本仓库是其中的**薄客户端 + 收件箱**两块;桌面 Obsidian 插件独立在 [obsidian-wechat-clipper](https://github.com/qlxxkj/obsidian-wechat-clipper) 仓库(已按插件市场规范拆分,可上架社区市场)。

核心思路:

- **小程序是薄客户端**:只做"投链接/图文/视频 + 输 6 位设备码",不预览不转换。
- **收件箱是极薄的 Cloudflare Worker + KV**:存待办 + 两层去重 + ACK,零业务逻辑,免费额度即可。
- **重活全在桌面 Obsidian 插件本地**(另一仓库):抓活网页 → Defuddle 抽正文 → Markdown + frontmatter → 去重写进 vault;视频走本地媒体管线(yt-dlp/ffmpeg/whisper)。

## 两块

| 目录 | 角色 | 关键点 |
|---|---|---|
| `inbox/` | Cloudflare Worker + KV 收件箱 | `POST /v1/claim`(投)、`GET /v1/pending`(拉)、`POST /v1/ack`(清)、`GET /v1/devices`(管理)。两层去重:全局 URL + 按设备内容哈希 |
| `miniapp/` | 微信小程序 | 只 `POST /v1/claim` 投待办,输 6 位码绑定设备;不预览不转换 |

桌面插件:见 [obsidian-wechat-clipper](https://github.com/qlxxkj/obsidian-wechat-clipper)。

## 数据流

```
小程序(投 链接/图文 + 6位码)
   │  POST /v1/claim?code=xxxxxx   (只存一条待办,不转换)
   ▼
Cloudflare Worker + KV(收件箱,两层去重:全局 URL + 按设备内容哈希)
   │  GET /v1/pending?code=  桌面插件 poll(默认 5 分钟一次)
   ▼
桌面 Obsidian 插件(另一仓库:本地转换 + 写库 + 去重)
   │  POST /v1/ack{ids}  写完回 ACK,收件箱清掉
   ▼
本地 vault(.md 落到 Clippings/)
```

## 快速开始

```bash
# 1) 部署收件箱(需 Cloudflare 账号 + wrangler 登录)
cd inbox && npm install
npx wrangler kv:namespace create INBOX        # 把返回的 id 填进 wrangler.toml
npx wrangler deploy                             # 得到 https://...workers.dev

# 2) 小程序
微信开发者工具导入 miniapp/;设置页填 收件箱 Worker 地址 + 同一个 6 位码

# 3) 桌面插件(另一仓库 obsidian-wechat-clipper)
git clone https://github.com/qlxxkj/obsidian-wechat-clipper
cd obsidian-wechat-clipper && npm install && npm run build
# 把 main.js + manifest.json 拷进 <你的vault>/.obsidian/plugins/wechat-inbox-sync/
# Obsidian 设置里填 收件箱地址 + 点「生成」拿 6 位码(与小程序同一个)
```

详见各子目录 README。

## 两层去重

1. **L1 全局 URL**:同一 url 全站只收一次(防不同设备重复投同一篇)。KV 键 `dedup_url:<sha1(url)>`,TTL 7 天。
2. **L2 按设备内容哈希**:同设备同内容(即便 url 不同或没 url)不重复。KV 键 `dedup_content:<code>:<sha1(content)>`,TTL 7 天。
3. 桌面插件端再补一层**本地内容缓存 + 文件存在性**(不覆盖已存在文件),防 KV 去重键过期后重投。

## 视频管线(可选)

投待办时 `kind: "video"` + `url`(B 站/抖音/快手/视频号/YouTube 链接,或带视频 iframe 的页面),桌面插件本地:

```
读登录态 cookie(按浏览器/域名) → yt-dlp 下视频 + 抽 CC 字幕
   ↓ 无 CC 且装了 whisper.cpp → ffmpeg 抽音频 + 本地 ASR 出 SRT
   ↓
视频入 vault 附件(createBinary) + MD 笔记内联字幕正文
```

- 不需要本地装 whisper 也能跑:有平台 CC 字幕就走 CC;whisper.cpp 是"无 CC 时"的可选兜底。
- 支持 iframe:yt-dlp 直下失败时,抓页面 `<iframe>`/`<video>` src,匹配已知视频平台逐个重试。
- 免手贴 SESSDATA:读本机浏览器登录态 cookie,自动喂 yt-dlp。
- 装法 + 设置项见 obsidian-wechat-clipper 仓库 README「装媒体工具」。
