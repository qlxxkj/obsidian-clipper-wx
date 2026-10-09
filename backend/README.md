# clipper-backend

Obsidian Web Clipper 的服务端移植。小程序（`../clipper-miniapp`）是**薄客户端**——它只负责输入 URL 或纯图文、预览结果；真正的「网页 → Markdown」转换全部在这里完成。

转换管线复用了 Obsidian Web Clipper 的核心库：

- **Defuddle**（`defuddle/node`）：正文抽取 + 元数据，默认转成 Markdown。
- **linkedom**：环境无关的 DOM，喂给 Defuddle。
- 输出 = Obsidian 风格 **YAML frontmatter + Markdown 正文**。

## 安装 & 运行

```bash
cd clipper-backend
npm install
npm start                 # 默认 http://127.0.0.1:8090
```

可选环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8090` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址，公网部署用 `0.0.0.0` |
| `CLIPPER_TOKEN` | 空 | 设置后启用鉴权，请求带 `x-clipper-token` 或 `Authorization: Bearer <token>` |
| `CLIPPER_ALLOWED_DOMAINS` | 空 | `/clip` 可抓取域名的白名单，逗号分隔，空 = 不限制（开发用） |
| `CLIPPER_ALLOW_ORIGIN` | `*` | CORS 允许来源 |

## API

### `POST /clip` — 网页剪藏

```jsonc
{
  "url": "https://example.com/article",
  "tags": ["clippings"],          // 可选
  "template": "{{frontmatter}}\n\n## 摘要\n{{content}}",  // 可选，见下方变量
  "selector": "main article",     // 可选，指定正文选择器
  "language": "en"                // 可选，Accept-Language
}
```

返回：

```jsonc
{
  "markdown": "---\ntitle: \"Array\"\nsource: \"developer.mozilla.org\"\n...\n---\n\n正文…",
  "content": "正文 Markdown",
  "contentHtml": "正文 HTML",
  "meta": { "title": "Array", "domain": "developer.mozilla.org", "wordCount": 828, "...": "..." }
}
```

模板变量（和 Obsidian Web Clipper 对齐）：
`{{frontmatter}} {{title}} {{author}} {{url}} {{published}} {{created}} {{description}} {{domain}} {{site}} {{image}} {{wordCount}} {{content}} {{contentHtml}} {{fullHtml}}`

### `POST /clip/pure` — 纯图文转发

不联网抓取，直接把调用方已有的内容（标题/正文 Markdown、自定义 frontmatter）规整成一条笔记。这是「纯图文」入口。

```jsonc
{ "content": "# 标题\n正文…", "title": "可选", "url": "可选", "tags": ["demo"], "frontmatter": { "source": "wechat" } }
```

返回 `{ markdown, frontmatter, content }`。

### `GET /health` — 连通性检测

## 部署到公网（给小程序调用）

小程序只能用**已加白的 HTTPS 域名**（`request 合法域名`）访问后端，不能走 `127.0.0.1`。所以：

1. 部署到一台有公网 IP / 域名的机器（或 Vercel/Render/Cloud Run 等 Serverless）。
2. 用 `CLIPPER_TOKEN` 开鉴权、`CLIPPER_ALLOWED_DOMAINS` 限制可抓取域，防止被当开放代理。
3. 配 HTTPS（证书），把该域加入小程序后台「开发设置 → 服务器域名 → request 合法域名」。
4. 在小程序「设置」页填上这个 HTTPS 地址即可。

最小 systemd 示例：

```ini
[Service]
ExecStart=/usr/bin/node /path/to/clipper-backend/server.mjs
Environment=HOST=0.0.0.0 PORT=8090 CLIPPER_TOKEN=change-me CLIPPER_ALLOWED_DOMAINS=example.com
```

## 局限

- 默认直接抓 HTML，再喂给 Defuddle。对**强依赖 JS 渲染**的页面（SPA），直接抓到的 DOM 可能缺失正文。需要时可把抓取换成 headless 浏览器（Playwright/Puppeteer）拿渲染后的 HTML，再交给同一条 Defuddle 管线——接口不变。
