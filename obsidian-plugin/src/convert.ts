// 本地转换引擎:抓活网页 → Defuddle 抽正文 → Markdown + frontmatter。
// 跑在 Obsidian 桌面插件里(Electron),可直接用 defuddle/node + linkedom,
// 不像 Cloudflare Worker 有 DOM 限制。这就是"重活放在插件本地"的实现。

import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";

export interface ConvertResult {
    markdown: string;
    content: string; // 正文 Markdown
    title: string;
    author?: string;
    published?: string;
    domain?: string;
    wordCount?: number;
    description?: string;
}

const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 wechat-inbox/0.1";

export function buildFrontmatter(
    meta: { title: string; author?: string; published?: string; domain?: string; description?: string; url: string },
    tags: string[],
): string {
    const lines: string[] = [];
    const s = (v: string) => JSON.stringify(v);
    lines.push(`title: ${s(meta.title || "")}`);
    lines.push(`source: ${s(meta.url)}`);
    lines.push(`source_type: ${s("web")}`);
    if (meta.author) lines.push(`author: [[${meta.author}]]`);
    if (meta.published) lines.push(`published: ${s(new Date(meta.published).toISOString().slice(0, 10))}`);
    lines.push(`created: ${s(new Date().toISOString().slice(0, 10))}`);
    if (meta.description) lines.push(`description: ${s(meta.description)}`);
    lines.push(`tags:\n  - ${[...new Set(tags)].map((t) => s(t)).join("\n  - ")}`);
    return `---\n${lines.join("\n")}\n---\n\n`;
}

/**
 * 抓取一个 URL,返回干净的 Markdown(带 frontmatter)+ 正文。
 * 中文站反爬(知乎/头条/小红书等)可按需在此加按站解析器;默认走 Defuddle 通用去噪。
 */
import { convertWeixin, isWeixinArticle } from "./weixin";

export async function convertUrl(url: string, tags: string[] = ["clippings"]): Promise<ConvertResult> {
    const target = url.trim();

    // 公众号文章按站兜底:微信 App UA + 识别验证页 + 定向抽 js_content
    if (isWeixinArticle(target)) {
        return convertWeixinArticle(target, tags);
    }

    const resp = await fetch(target, {
        redirect: "follow",
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    // Obsidian 桌面环境里 linkedom 是独立 DOM;喂给 defuddle/node。
    const { document } = parseHTML(html, { url: target });
    const result = await Defuddle(document, target, { markdown: true, separateMarkdown: true });

    const content = result.contentMarkdown ?? result.content ?? "";
    const meta = {
        title: result.title || "",
        author: result.author,
        published: result.published,
        domain: result.domain,
        description: result.description,
        url: target,
    };
    const markdown = buildFrontmatter(meta, tags) + content;
    return {
        markdown,
        content,
        title: meta.title,
        author: meta.author,
        published: meta.published,
        domain: meta.domain,
        wordCount: result.wordCount,
        description: meta.description,
    };
}

/** 公众号文章:微信 App UA 抓 + 识别验证页,正文 HTML 再喂 Defuddle 清洗成 MD。 */
async function convertWeixinArticle(url: string, tags: string[] = ["clippings"]): Promise<ConvertResult> {
    const target = url.trim();
    const wx = await convertWeixin(target);
    // 正文 HTML → Defuddle 抽正文(去多余节点/广告),转 Markdown
    let content = "";
    if (wx.contentHtml) {
        const { document } = parseHTML(wx.contentHtml, { url: target });
        const result = await Defuddle(document, target, { markdown: true, separateMarkdown: true });
        content = result.contentMarkdown ?? result.content ?? "";
    }
    // 验证页兜底:拿不到正文就提示,但仍落笔记(标题/作者/来源可查)
    if (wx.verified && !content) {
        content = "> ⚠️ 微信「环境异常,请验证」页面,正文未抓取到。可稍后在桌面端重试,或手动把正文粘进来。";
    }

    const meta = {
        title: wx.title,
        author: wx.author,
        published: wx.published,
        domain: "mp.weixin.qq.com",
        description: wx.description,
        url: target,
    };
    const markdown = buildFrontmatter(meta, tags) + (content || "");
    return {
        markdown,
        content,
        title: wx.title,
        author: wx.author,
        published: wx.published,
        domain: meta.domain,
        description: meta.description,
    };
}

/** 纯图文:直接包 frontmatter,不联网。 */
export function convertText(input: { title?: string; content: string; url?: string; tags?: string[] }): string {
    const tags = input.tags && input.tags.length ? input.tags : ["clippings"];
    const meta = {
        title: input.title || "",
        author: undefined as string | undefined,
        published: undefined as string | undefined,
        domain: undefined as string | undefined,
        description: undefined as string | undefined,
        url: input.url || "",
    };
    return buildFrontmatter(meta, tags) + String(input.content).trim();
}
