# clipper-miniapp（微信小程序端）

Obsidian Web Clipper 的微信小程序移植。小程序是**薄客户端**：只做输入（URL 或纯图文）和预览，**不做任何转换**——网页转 Markdown 的重活由 `../clipper-backend`（或你自己搭的后端 / 桌面端 Obsidian 插件）完成。

## 结构

```
clipper-miniapp/
  app.json / app.js / app.wxss        全局：页面路由、后端地址存 globalData
  utils/api.js                        调后端 /clip、/clip/pure 的薄封装（CommonJS，非 ESM）
  pages/
    index/      输入：网页链接 / 纯图文 / 标签 → 调后端 → 跳预览
    preview/    展示 Markdown 原文，复制 / 存本地 / 转发
    settings/   配置后端 HTTPS 地址 + token，连接测试
```

原生小程序（`wx` API，无构建步骤），可直接导入微信开发者工具。

## 使用流程

1. **微信开发者工具** → 导入本项目目录。
2. 先部署 `clipper-backend` 到 HTTPS 公网域，启动 `npm start`。
3. 开发期：devtools 右上角「详情 → 本地设置」勾 **不校验合法域名、webview（业务域名）**，设置页填 `http://127.0.0.1:8090` 测试。
4. 发布期：把后端域加到小程序后台「开发设置 → 服务器域名 → **request 合法域名**」（必须 HTTPS），设置页填该 HTTPS 域。
5. 首页输入链接或图文 → 点「剪藏」→ 自动跳预览 → 复制 / 存本地 / 转发。

## 关键约束（为什么是这个架构）

- 小程序**没有 DOM / 浏览器 JS 运行环境**，Obsidian Web Clipper 作为浏览器扩展的那套（读页面 DOM）在小程序里跑不了。
- 小程序网络只能打**加白的 HTTPS 域**，不能访问 `127.0.0.1`，也没有浏览器剪贴板/下载 API。
- 所以把「抓取 + Defuddle 抽取 + 模板 → Markdown」整段放到后端，小程序只传 URL/文本、收 Markdown。

## 后续可选扩展

- 后端加**收藏库**（SQLite/DB），小程序拉历史列表；现在是本地 `wx.setStorage` 存最近一条 + 复制/存文件。
- 正文用 `rich-text` 或 markdown 渲染组件做富文本预览（现在是 Markdown 原文）。
- 支持 `headless 浏览器` 抓 JS 渲染页（后端侧改抓取实现，接口不变）。
