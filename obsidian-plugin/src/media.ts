// 媒体管线:用 yt-dlp 下视频/抽音频,ffmpeg 备,whisper.cpp 可选。
// 跑在 Obsidian 桌面插件里(有 Node 的 child_process)。缺依赖时返回友好错误,
// 不阻塞其他内容同步。

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface MediaTooling {
    ytDlp?: string;
    ffmpeg?: string;
    whisperCli?: string;
    whisperModelDir?: string;
    whisperModel?: string;
}

/** 探测本机可用的媒体工具(路径可在设置里覆盖)。 */
export function detectMediaTooling(overrides: Partial<MediaTooling> = {}): MediaTooling {
    const which = (name: string): string | undefined => {
        try {
            const out = execFileSync("which", [name], {
                stdio: ["ignore", "pipe", "ignore"],
            })
                .toString()
                .trim();
            return out || undefined;
        } catch {
            return undefined;
        }
    };
    const ytDlp = overrides.ytDlp ?? which("yt-dlp") ?? which("yt-dlp") ?? "yt-dlp";
    const ffmpeg = overrides.ffmpeg ?? which("ffmpeg");
    const whisperCli = overrides.whisperCli ?? which("whisper-cli");
    const whisperModelDir =
        overrides.whisperModelDir ?? path.join(os.homedir(), ".wechat-inbox-local-asr");
    return {
        ytDlp,
        ffmpeg,
        whisperCli,
        whisperModelDir,
        whisperModel: overrides.whisperModel,
    };
}

export function hasYtDlp(t: MediaTooling): boolean {
    return !!t.ytDlp;
}
export function hasFfmpeg(t: MediaTooling): boolean {
    return !!t.ffmpeg;
}
export function hasWhisper(t: MediaTooling): boolean {
    return !!t.whisperCli && !!t.whisperModel;
}

export interface DownloadResult {
    ok: boolean;
    videoPath?: string; // 本地视频文件(绝对路径)
    subtitleText?: string; // 抓下来的字幕文本(SRT 或时间戳文本)
    error?: string;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const p: ChildProcess = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
        p.stdout?.on("data", (d) => (out += d));
        p.stderr?.on("data", (d) => (err += d));
        p.on("error", (e) => {
            clearTimeout(timer);
            reject(e);
        });
        p.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve(out);
            else reject(new Error(`${bin} exit ${code}: ${err.slice(0, 400)}`));
        });
    });
}

/**
 * 下载视频到临时目录(不入库,入库由插件 createBinary 做)。
 * @returns 视频文件绝对路径
 */
export async function downloadVideo(
    t: MediaTooling,
    url: string,
    outDir: string,
    cookiesFile?: string,
): Promise<string> {
    if (!hasYtDlp(t)) throw new Error("yt-dlp 未安装(pip install yt-dlp 或装官方发布版)");
    fs.mkdirSync(outDir, { recursive: true });
    const template = path.join(outDir, "media.%(ext)s");
    const args = [
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", template,
        "--no-playlist",
        "--retries", "2",
        "--socket-timeout", "60",
    ];
    if (cookiesFile) args.push("--cookies", cookiesFile);
    args.push(url);
    const out = await run(t.ytDlp!, args, 15 * 60 * 1000);
    // 找产物
    const files = fs.readdirSync(outDir);
    const mp4 = files.find((f) => /\.(mp4|webm|mkv|mov|m4a)$/i.test(f));
    if (!mp4) throw new Error(`视频下载完成但没找到产物:\n${out.slice(0, 200)}`);
    return path.join(outDir, mp4);
}

/**
 * 抓平台 CC 字幕。yt-dlp 对 B 站/YouTube 等支持 --write-srt。
 * 返回 SRT 文本;没有则 undefined。
 */
export async function fetchSubtitles(
    t: MediaTooling,
    url: string,
    outDir: string,
    cookiesFile?: string,
): Promise<string | undefined> {
    if (!hasYtDlp(t)) return undefined;
    fs.mkdirSync(outDir, { recursive: true });
    const args = [
        "--no-download",
        "--write-srt",
        "--sub-langs", "zh,en,zh-Hans,zh-Hans-CN",
        "--skip-subs",
        "--convert-subs", "srt",
        "-o", path.join(outDir, "sub.%(ext)s"),
        "--no-playlist",
        "--retries", "2",
        "--socket-timeout", "60",
    ];
    if (cookiesFile) args.push("--cookies", cookiesFile);
    args.push(url);
    let out = "";
    try {
        out = await run(t.ytDlp!, args, 5 * 60 * 1000);
    } catch {
        // 没有 CC 字幕时 yt-dlp 可能非 0 退出,忽略
    }
    // 收集产物里所有 .srt
    let combined = "";
    for (const f of fs.readdirSync(outDir)) {
        if (f.endsWith(".srt")) combined += fs.readFileSync(path.join(outDir, f), "utf8") + "\n";
    }
    return combined.trim() || undefined;
}

/** ffmpeg 抽单声道 16k wav(给 whisper 用)。 */
export async function extractAudio(
    t: MediaTooling,
    videoPath: string,
    wavPath: string,
): Promise<void> {
    if (!hasFfmpeg(t)) throw new Error("ffmpeg 未安装,无法抽音频");
    await run(t.ffmpeg!, ["-y", "-i", videoPath, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", wavPath], 10 * 60 * 1000);
}

/** whisper.cpp 本地 ASR。返回 SRT 文本。 */
export async function transcribeLocal(
    t: MediaTooling,
    wavPath: string,
    outBase: string,
): Promise<string> {
    if (!hasWhisper(t)) throw new Error("whisper.cpp 未安装/未指定模型(可选组件)");
    await run(
        t.whisperCli!,
        [
            "-m", t.whisperModel!,
            "-f", wavPath,
            "-s", "zh",
            "-l", "zh",
            "-otxt", "-osrt",
            "-of", outBase,
        ],
        30 * 60 * 1000,
    );
    return fs.readFileSync(`${outBase}.srt`, "utf8");
}

/** 清理临时目录。 */
export function cleanupDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
}
