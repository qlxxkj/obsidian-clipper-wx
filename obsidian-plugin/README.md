# obsidian-plugin(桌面 Obsidian 插件:本地转换 + 写库)

这是整套里"重活"所在:poll 收件箱 → **本地**抓活网页 → Defuddle 抽正文+元数据 → 套 Obsidian 风格 frontmatter → 图片本地化(可选)→ 去重 → `app.vault.create` 写进 vault → 回 ACK。视频类待办走独立媒体管线:yt-dlp 下视频+抽字幕(或 whisper.cpp 本地转写)→ 视频入 vault 附件 + MD 笔记内联字幕。

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
| 视频附件目录 | 相对 vault 根,默认 `Attachments`,视频/SRT 落这里 |
| 下载视频文件 | 关闭则只抓字幕/转写文本,不落视频附件(省空间) |
| 读登录态 cookie 的浏览器 | `none`(公开视频)或某浏览器;选浏览器则自动读其登录态 cookie,免手贴 SESSDATA |
| 检查视频工具 | 一键探测本机 yt-dlp / ffmpeg / whisper / 浏览器 cookie 是否就位 |

## 行为

- **去重(三层)**:① 同名文件已存在不覆盖;② 本地内容哈希 7 天缓存不重投;③ 收件箱侧 L1/L2(见 `../inbox`)。
- **content 纯图文**:待办 `kind=text` 时不联网,直接包 frontmatter 写入。
- **网页**:本地 `fetch` 活网页 → Defuddle。中文站(公众号/知乎/头条/小红书等)若被反爬挡住,可在 `src/convert.ts` 加按站解析器(参考 `chenyk0317/obsidian-weixin-sync` 的 `src/parsers/`)。
- **视频**:待办 `kind=video` + `url` 时走媒体管线(`src/video.ts`):
  1. 按设置读某浏览器的登录态 cookie(Chromium 系 SQLite 解密 / Firefox),导出 Netscape 文件喂 yt-dlp——B 站/抖音/快手/视频号有 CC 字幕与会员视频都能用上已登录会话;
  2. `yt-dlp` 下视频到临时目录(失败则抓页面 iframe/video src 逐个重试,匹配 bilibili/douyin/kuaishou/youtube/weixin 等已知平台);
  3. 抓平台 CC 字幕(`--write-srt`);无 CC 且装了 whisper.cpp 时,ffmpeg 抽 16k 单声道 wav → 本地 ASR 出 SRT;
  4. 视频写 `vault.createBinary` 入附件目录,字幕**内联进 MD 笔记正文**(可检索/可读),whisper 产物另存 `.srt` 附件;
  5. 缺工具时返回友好 Notice,不阻塞其他图文/网页同步。

### 装媒体工具(可选)

```bash
# 视频下载 + 抓 CC 字幕
pip install yt-dlp            # 或装官方发布版
# 抽音频(whisper 路径才需要)
brew install ffmpeg           # 或 apt install ffmpeg
# 本地 ASR(可选,没 CC 字幕时兜底)
# 见 whisper.cpp 官方: 编译 whisper-cli + 下载模型(如 ggml-small.bin)
```

插件设置里点「检查视频工具」会打印当前探测结果,缺啥一目了然。

## 已知取舍

- 默认走 **HTTP fetch**,对需要 JS 渲染的 SPA 拿不到正文。要覆盖这类页面,把 `convert.ts` 里的 `fetch` 换成 headless(Playwright/Puppeteer)拿渲染后 HTML,再喂 Defuddle——接口不变。
- 图片本地化是"可选 TODO":当前正文里的图片保留原 URL,`createBinary` 下载入 vault 的写法已留好桩。
- 视频管线依赖本机装好 `yt-dlp`(必需);`ffmpeg`/`whisper.cpp` 为可选(分别对应抽音频转写路径)。Windows 上 Chromium 系 cookie 的 DPAPI 解密暂未实现(回退读明文 cookie),macOS/Linux 走 Keychain / gnome-keyring。
- 抖音/快手/视频号的 yt-dlp 支持度依赖上游,部分页面需登录态(故提供浏览器 cookie 读取);拿不到时只写正文笔记、不下载视频。
