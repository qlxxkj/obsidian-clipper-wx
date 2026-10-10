// 微信公众号文章(mp.weixin.qq.com)专用解析器。
// 公众号文章服务端直出完整 HTML(正文在 <div id="js_content">),但微信对
// 非微信 UA / 机房 IP 常返回「环境异常,请验证后继续」的验证页 —— 通用 Defuddle
// 拿不到正文。这里按站兜底:微信 App UA 重试 + 识别验证页 + 定向抽正文/元数据。
// 参考 chenyk0317/obsidian-weixin-sync 的按站解析思路,简化到能跑的最小集。

import { parseHTML } from "linkedom";

const WEIXIN_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49";

export interface WeixinResult {
    title: string;
    author?: string;
    published?: string; // ISO 日期
    description?: string;
    contentHtml: string; // js_content 的 innerHTML(给 Defuddle 二次清洗或直接转 MD)
    verified: boolean; // 是否为「环境异常」验证页
    rawUrl: string;
}

export function isWeixinArticle(url: string): boolean {
    try {
        const h = new URL(url).hostname;
        return h === "mp.weixin.qq.com";
    } catch {
        return false;
    }
}

async function fetchWithUa(url: string, ua: string): Promise<string> {
    const resp = await fetch(url, {
        redirect: "follow",
        headers: {
            "User-Agent": ua,
            Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
            "Referer": "https://mp.weixin.qq.com/",
        },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
}

/**
 * 抓公众号文章正文。先用默认桌面 UA,命中验证页则换微信 App UA 重试一次。
 * @returns 解析结果;`verified` 为 true 表示仍是验证页(调用方应跳过正文、仅记元数据)。
 */
export async function convertWeixin(url: string): Promise<WeixinResult> {
    let html = await fetchWithUa(url, WEIXIN_UA);

    // 验证页特征:有「环境异常」或「完成验证」,且没有 js_content
    const isVerification =
        /环境异常|完成验证|请验证后继续/.test(html) && !/id="js_content"/.test(html);
    if (isVerification) {
        // 换桌面 UA 再试一次(有些 IP 对桌面 UA 放行)
        try {
            const html2 = await fetchWithUa(url, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36");
            const v2 = /环境异常|完成验证|请验证后继续/.test(html2) && !/id="js_content"/.test(html2);
            if (!v2) html = html2;
        } catch {
            /* 保留第一次结果 */
        }
    }
    const stillVerified = /环境异常|完成验证|请验证后继续/.test(html) && !/id="js_content"/.test(html);

    const { document } = parseHTML(html, { url });
    const q = (sel: string) => document.querySelector(sel)?.textContent?.trim() || "";
    const ce = (sel: string) => document.querySelector(sel)?.getAttribute("content") || "";

    const title = q(".rich_media_title, #activity-name") || document.title || "";
    const author = ce("meta[name=author]") || q("#js_name, .wx_follow_nickname");
    const publishMeta = ce("meta[property='article:published_time']") || ce("meta[name=publish_time]");
    const published = publishMeta ? publishMeta : undefined;
    const description = ce("meta[name=description]") || ce("meta[name=weixin_og_description]");

    const jsContentEl = document.querySelector("#js_content") || document.querySelector(".rich_media_content");
    const contentHtml = jsContentEl ? (jsContentEl as any).innerHTML || "" : "";

    return {
        title,
        author,
        published,
        description,
        contentHtml,
        verified: stillVerified || contentHtml === "",
        rawUrl: url,
    };
}
