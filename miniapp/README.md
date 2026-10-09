# miniapp(微信小程序端:薄投递)

微信小程序是**薄投递端**:只做两件事——① 输入 链接 或 纯图文,② 点「投到收件箱」把它塞进 Cloudflare Worker 收件箱(`POST /v1/claim?code=xxxxxx`)。**不预览、不转换、不写库**——那些全在桌面 Obsidian 插件里完成。

原生 `wx` API,无构建,可直接导入微信开发者工具。

## 目录

```
miniapp/
  app.json / app.js / app.wxss       全局:路由(index + settings)、globalData(inbox/code)
  utils/api.js                       claim() 薄封装:POST /v1/claim
  pages/
    index/     网页链接 / 纯图文 + 标签 → 投到收件箱 → 显示"已投,桌面端会拉取"
    settings/  填 收件箱 Worker 地址 + 6 位设备码,可测连接
```

## 使用

1. 微信开发者工具导入本目录。
2. **设置页**:填 Cloudflare Worker 的 HTTPS 域 + 6 位设备码(Obsidian 插件里「生成」拿到的那个)。
3. 开发期:devtools「详情 → 本地设置」勾 **不校验合法域名**。
4. 发布期:把 Worker 域加到小程序后台「开发设置 → 服务器域名 → **request 合法域名**」(必须 HTTPS)。
5. 首页投链接/图文 → 提示"已投收件箱,桌面端 Obsidian 插件会拉取并写入"。

## 为什么小程序这么薄

小程序没有 DOM/JS 运行环境,也打不到 `127.0.0.1`,只能打加白 HTTPS 域。所以它不可能"读页面 DOM"或"直接写你电脑的 Obsidian"。重活放桌面插件、中间只留一个无状态收件箱,是这套架构最省的组合。
