// 读手机剪贴板,提取可投递的内容:
//  - 剪贴板里有 http(s) 链接 → 填到 url,并按平台判断 kind(url/video)
//  - 视频平台(B站/抖音/快手/视频号/YouTube)的链接 → kind=video,桌面插件本地下载+抽字幕
//  - 普通网页链接 → kind=url,桌面插件 Defuddle 转正文
//  - 没链接但有纯文本 → 走图文模式(text),填到 textContent
// 微信 wx.getClipboardData 返回 Promise(基础库 2.10.4+);低版本用回调。

// 已知视频平台:命中则标记 video,让桌面插件走媒体管线(yt-dlp)
const VIDEO_HOSTS = [
    /bilibili\.com/i,
    /douyin\.com|iesdouyin\.com/i,
    /kuaishou\.com|chenxiaoshi\.com/i,
    /channels\.weibo\.com/i, // 微博视频号
    /youtube\.com|youtu\.be/i,
    /weixin\.qq\.com\/c\//i, // 微信视频号分享链接
];

// 从任意文本里抠第一个 http(s) URL(剪贴板可能带前后缀/分享文案)
function extractUrl(text) {
    if (!text) return "";
    const m = String(text).match(/https?:\/\/[^\s"'<>()（）【】,，]+/i);
    return m ? m[0] : "";
}

function isVideoUrl(url) {
    if (!url) return false;
    let host;
    try {
        host = new URL(url).hostname;
    } catch {
        host = url;
    }
    return VIDEO_HOSTS.some((re) => re.test(host) || re.test(url));
}

function readClipboard() {
    return new Promise((resolve) => {
        if (wx.canIUse && wx.canIUse("getClipboardData")) {
            wx.getClipboardData({
                success: (res) => resolve((res.data || "").trim()),
                fail: () => resolve(""),
            });
            return;
        }
        // 兜底:直接读(个别低版本同步 API)
        try {
            const r = wx.getClipboardDataSync && wx.getClipboardDataSync();
            resolve((r && r.data ? r.data : "").trim());
        } catch {
            resolve("");
        }
    });
}

/**
 * 解析剪贴板内容 → { kind, url?, content?, title? }
 * kind: "video" | "url" | "text" | null
 * 返回 null 表示剪贴板里没有可投递的东西。
 */
async function parseClipboard() {
    const raw = await readClipboard();
    if (!raw) return null;
    const url = extractUrl(raw);
    if (url) {
        return isVideoUrl(url) ? { kind: "video", url } : { kind: "url", url };
    }
    // 没有链接,纯文本 → 图文
    if (raw.length > 0) return { kind: "text", content: raw };
    return null;
}

module.exports = { extractUrl, isVideoUrl, parseClipboard, readClipboard };
