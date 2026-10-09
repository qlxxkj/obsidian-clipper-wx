# obsidian-clipper-wx

把 **Obsidian Web Clipper** 移植成**微信小程序**的独立项目。

小程序是**薄客户端**：只做输入（URL 或纯图文）和预览，不做任何转换。真正的「网页 → Markdown」转换放在后端（本仓库的 `backend/`，复用 Obsidian Web Clipper 的核心库 Defuddle + linkedom），也可换你自己的后端或桌面端 Obsidian 插件。

## 目录

| 目录 | 说明 |
|---|---|
| `backend/` | 服务端转换引擎（Node）。`POST /clip` 网页剪藏、`POST /clip/pure` 纯图文转发。详见 `backend/README.md` |
| `miniapp/` | 微信小程序（原生 `wx` API，无构建）。`index` 输入 / `preview` 预览 / `settings` 配置后端。详见 `miniapp/README.md` |

## 数据流

```
小程序(输入 URL / 纯图文)
   │  wx.request(HTTPS 加白域)
   ▼
backend  ① 抓 HTML ② Defuddle 抽正文+元数据 ③ 套模板(frontmatter + {{变量}})
   │
   ▼
小程序(收 Markdown → 预览 / 复制 / 存本地 / 转发)
```

## 快速开始

```bash
cd backend && npm install && npm start   # http://127.0.0.1:8090
# 小程序：微信开发者工具导入 miniapp/，设置页填后端地址
```

详见各子目录 README。
