# obsidian-plugin(桌面 Obsidian 插件:本地转换 + 写库)

这是整套里"重活"所在:poll 收件箱 → **本地**抓活网页 → Defuddle 抽正文+元数据 → 套 Obsidian 风格 frontmatter → 图片本地化(可选)→ 去重 → `app.vault.create` 写进 vault → 回 ACK。

对应参考实现:`less1001/obsync`(`vault.create/modify`)、`mingjuner123-spec/wechat-inbox-sync`(`vault.adapter.write`)的最后一里,但转换引擎用 **Defuddle**(比 Readability 去噪更狠)。

## 构建

```bash
cd obsidian-plugin && npm install
npm run build          # 产出 main.js(defuddle + linkedom 已打包进去)
```

把 `main.js` 和 `manifest.json` 拷进 `<你的vault>/.obsidian/plugins/wechat-inbox-sync/`,重启 Obsidian,启用插件。

开发期热更:`npm run dev`(esbuild watch)。

## 设置(Obsidian 里)

| 项 | 说明 |
|---|---|
| 收件箱地址 | Cloudflare Worker HTTPS 域 |
| 设备码 (6 位) | 点「生成」拿一个,小程序里填同一个 |
| 同步间隔(分钟) | 0 = 只手动(点左侧收件箱图标 / 命令面板「立即同步收件箱」) |
| 写入目录 | 相对 vault 根,默认 `Clippings` |
| 写库前确认 | 手动同步时逐条弹确认 |

## 行为

- **去重(三层)**:① 同名文件已存在不覆盖;② 本地内容哈希 7 天缓存不重投;③ 收件箱侧 L1/L2(见 `../inbox`)。
- **content 纯图文**:待办 `kind=text` 时不联网,直接包 frontmatter 写入。
- **网页**:本地 `fetch` 活网页 → Defuddle。中文站(公众号/知乎/头条/小红书等)若被反爬挡住,可在 `src/convert.ts` 加按站解析器(参考 `chenyk0317/obsidian-weixin-sync` 的 `src/parsers/`)。

## 已知取舍

- 默认走 **HTTP fetch**,对需要 JS 渲染的 SPA 拿不到正文。要覆盖这类页面,把 `convert.ts` 里的 `fetch` 换成 headless(Playwright/Puppeteer)拿渲染后 HTML,再喂 Defuddle——接口不变。
- 图片本地化是"可选 TODO":当前正文里的图片保留原 URL,`createBinary` 下载入 vault 的写法已留好桩。
