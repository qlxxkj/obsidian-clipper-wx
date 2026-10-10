// 视频管线编排:下载视频 + 抽字幕(CC 优先,无 CC 且有 whisper 时本地转写)。
// 跑在 Obsidian 桌面插件里(Electron,有 Node 的 fs / 全局 fetch)。
// 依赖 media.ts(外部工具)和 browser.ts(读登录态 cookie),不引入重依赖。

import {
    MediaTooling,
    hasYtDlp,
    hasWhisper,
    downloadVideo,
    fetchSubtitles,
    extractAudio,
    transcribeLocal,
} from "./media";
import { BrowserKind, exportBrowserCookies } from "./browser";
import * as fs from "node:fs";
import * as path from "node:path";

export interface VideoProcessResult {
    ok: boolean;
    videoPath?: string; // 临时视频文件绝对路径(成功时)
    subtitles?: string; // 字幕文本(SRT);来源见 transcriptSource
    transcriptSource?: "cc" | "whisper";
    error?: string; // 下载或字幕某一步的软错误(不阻断另一步)
}

const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 wechat-inbox/0.1";

/** 从视频/页面 url 推 eTLD+1,用于匹配 cookie 域名(去掉 www./m. 前缀)。 */
export function hostForCookie(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    } catch {
        return "";
    }
}

/** 按浏览器读登录态 cookie,导出 Netscape 文件给 yt-dlp;none 或未配则 undefined。 */
export function cookiesForUrl(
    browser: BrowserKind | "none" | undefined,
    url: string,
): string | undefined {
    if (!browser || browser === "none") return undefined;
    const host = hostForCookie(url);
    if (!host) return undefined;
    return exportBrowserCookies(browser, [host]) ?? undefined;
}

/**
 * 处理一个视频 url:
 *  1. 取 cookie(可选,从本机浏览器读登录态);
 *  2. yt-dlp 下视频到临时目录(失败则抓页面 iframe/video src 重试);
 *  3. 抓平台 CC 字幕;没有则(有 whisper 时)抽音频 + 本地转写。
 *  下载与字幕互不阻断:一步成功整体即 ok。
 */
export async function processVideo(
    t: MediaTooling,
    url: string,
    tmpDir: string,
    opts: { cookieBrowser?: BrowserKind | "none"; saveVideo?: boolean } = {},
): Promise<VideoProcessResult> {
    if (!hasYtDlp(t)) {
        return { ok: false, error: "yt-dlp 未安装,无法处理视频(pip install yt-dlp 或装官方发布版)" };
    }
    const cookieFile = cookiesForUrl(opts.cookieBrowser, url);
    const subDir = path.join(tmpDir, "subs");
    fs.mkdirSync(subDir, { recursive: true });
    let hardError: string | undefined;

    // 1) 下载视频(可选)
    let videoPath: string | undefined;
    if (opts.saveVideo !== false) {
        try {
            videoPath = await downloadVideo(t, url, tmpDir, cookieFile);
        } catch (e) {
            hardError = e instanceof Error ? e.message : String(e);
            // 兜底:从页面找 iframe / video 的 src,逐个再试
            for (const cand of await extractCandidateMediaUrls(url)) {
                try {
                    videoPath = await downloadVideo(t, cand, tmpDir, cookieFile);
                    hardError = undefined;
                    break;
                } catch {
                    /* 继续下一个候选 */
                }
            }
        }
    }

    // 2) 字幕:先 CC
    let subtitles: string | undefined;
    let transcriptSource: "cc" | "whisper" | undefined;
    try {
        subtitles = await fetchSubtitles(t, url, subDir, cookieFile);
        if (subtitles) transcriptSource = "cc";
    } catch {
        /* 无 CC */
    }

    // 3) 无 CC 且有 whisper → 抽音频 + 本地转写
    if (!subtitles && hasWhisper(t)) {
        try {
            if (!videoPath) videoPath = await downloadVideo(t, url, tmpDir, cookieFile);
            const wavPath = path.join(tmpDir, "audio.wav");
            const outBase = path.join(tmpDir, "asr");
            await extractAudio(t, videoPath, wavPath);
            subtitles = await transcribeLocal(t, wavPath, outBase);
            if (subtitles) transcriptSource = "whisper";
        } catch (e) {
            hardError = hardError || (e instanceof Error ? e.message : String(e));
        }
    }

    if (!videoPath && !subtitles) {
        return { ok: false, error: hardError || "视频下载与字幕抓取均失败(检查 yt-dlp / 登录态 cookie)" };
    }
    return { ok: true, videoPath, subtitles, transcriptSource, error: hardError };
}

/** 抓页面里的 iframe/video src,优先匹配已知视频平台,返回候选直链。 */
async function extractCandidateMediaUrls(pageUrl: string): Promise<string[]> {
    try {
        const resp = await fetch(pageUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
        if (!resp.ok) return [];
        const html = await resp.text();
        const srcs: string[] = [];
        let m: RegExpExecArray | null;
        for (const re of [
            /<iframe[^>]+src=["']([^"']+)["']/gi,
            /<video[^>]+src=["']([^"']+)["']/gi,
            /data-?src=["']([^"']+)["']/gi,
        ]) {
            while ((m = re.exec(html))) srcs.push(m[1]);
        }
        const known =
            /bilibili\.com|douyin\.com|kuaishou\.com|youtube\.com|weixin\.com|channels\.weibo|qq\.com/i;
        return srcs.filter((s) => known.test(s)).concat(srcs.filter((s) => !known.test(s)));
    } catch {
        return [];
    }
}
