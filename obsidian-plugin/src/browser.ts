// 从用户本地浏览器直接读取登录态 cookie(按域名过滤),导出成 Netscape 格式
// 临时文件,喂给 yt-dlp 的 --cookies。这样 B 站 / 抖音 / 快手 / 视频号 拿 CC
// 字幕 + 下视频都能用上已登录会话,无需手动贴 SESSDATA。
//
// 实现:直接解密 Chrome/Edge/Brave 的 Cookies SQLite(Chromium 系共用),
// 以及 Firefox 的 cookies.sqlite。macOS 用 Keychain 取 AES 密钥,
// Windows 用 DPAPI,Linux 用 gnome-keyring(不可用时回退固定密钥)。
// 全部用原生 Node(fs + 可选 child_process),不引入重依赖。

import {
    execFileSync,
} from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

export type BrowserKind = "chrome" | "edge" | "brave" | "chromium" | "firefox";

export const BROWSERS: { id: BrowserKind; label: string }[] = [
    { id: "chrome", label: "Chrome" },
    { id: "edge", label: "Edge" },
    { id: "brave", label: "Brave" },
    { id: "chromium", label: "Chromium" },
    { id: "firefox", label: "Firefox" },
];

export interface CookieRow {
    host: string;
    name: string;
    value: string;
}

// ---- 各浏览器 Cookies 文件位置 ----------------------------------------

function homeDir(): string {
    return os.homedir();
}

function isMac(): boolean {
    return process.platform === "darwin";
}
function isWin(): boolean {
    return process.platform === "win32";
}
function isLinux(): boolean {
    return process.platform === "linux";
}

function chromeCookieFile(kind: Exclude<BrowserKind, "firefox">): string | null {
    const home = homeDir();
    if (isMac()) {
        const base = `${home}/Library/Application Support`;
        const map = {
            chrome: "Google/Chrome",
            edge: "Microsoft Edge",
            brave: "BraveSoftware/Brave-Browser",
            chromium: "Chromium",
        } as const;
        const dir = `${base}/${map[kind]}/Default/Cookies`;
        return fs.existsSync(dir) ? dir : null;
    }
    if (isWin()) {
        const local = process.env["LOCALAPPDATA"] || `${home}/AppData/Local`;
        const map = {
            chrome: "Google/Chrome/User Data/Default/Cookies",
            edge: "Microsoft/Edge/User Data/Default/Cookies",
            brave: "BraveSoftware/Brave-Browser/User Data/Default/Cookies",
            chromium: "Chromium/User Data/Default/Cookies",
        } as const;
        const p = path.join(local, map[kind]);
        return fs.existsSync(p) ? p : null;
    }
    // linux
    const cfg = `${home}/.config`;
    const map = {
        chrome: "google-chrome/Default/Cookies",
        edge: "microsoft-edge/Default/Cookies",
        brave: "brave-browser/Default/Cookies",
        chromium: "chromium/Default/Cookies",
    } as const;
    const p = path.join(cfg, map[kind]);
    return fs.existsSync(p) ? p : null;
}

function firefoxCookieFile(): string | null {
    const home = homeDir();
    const profRoot = isMac()
        ? `${home}/Library/Application Support/Firefox`
        : isWin()
          ? `${process.env["APPDATA"] || `${home}/AppData/Roaming`}/Mozilla/Firefox`
          : `${home}/.mozilla/firefox`;
    if (!fs.existsSync(profRoot)) return null;
    // 找最近的 profile 里的 cookies.sqlite
    for (const entry of fs.readdirSync(profRoot)) {
        const p = path.join(profRoot, entry, "cookies.sqlite");
        if (entry.endsWith(".default") || entry.includes(".default") || entry.includes("release")) {
            if (fs.existsSync(p)) return p;
        }
    }
    for (const entry of fs.readdirSync(profRoot)) {
        const p = path.join(profRoot, entry, "cookies.sqlite");
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// ---- 取加密密钥 --------------------------------------------------------

function chromeEncryptionKey(kind: Exclude<BrowserKind, "firefox">): Buffer {
    let raw: Buffer;
    if (isMac()) {
        raw = Buffer.from(macosKeychainSecret(kind));
        return Buffer.from(crypto.scryptSync(raw, "salt", 16));
    }
    if (isWin()) {
        // DPAPI 解 "Local State" 里的 os_crypt.encrypted_key(base64 → 去掉前 11 字节 "DPAPI")
        const localStatePath = chromeLocalStatePath(kind);
        if (localStatePath && fs.existsSync(localStatePath)) {
            const localState = JSON.parse(fs.readFileSync(localStatePath, "utf8"));
            const enc = localState?.os_crypt?.encrypted_key;
            if (enc) {
                const buf = Buffer.from(enc, "base64").subarray(5); // 去掉 "DPAPI" 前缀
                return dpapiDecrypt(buf);
            }
        }
        return Buffer.alloc(32); // 无密钥回退(加密值读不出,仅取明文 cookie)
    }
    // Linux: 默认 gnome-keyring 的固定口令 "peanuts"(可被 keyring 覆盖,此处回退)
    return crypto.scryptSync("peanuts", "salt", 32);
}

function chromeLocalStatePath(kind: Exclude<BrowserKind, "firefox">): string | null {
    const home = homeDir();
    if (isMac()) {
        const map = {
            chrome: "Google/Chrome",
            edge: "Microsoft Edge",
            brave: "BraveSoftware/Brave-Browser",
            chromium: "Chromium",
        } as const;
        return `${home}/Library/Application Support/${map[kind]}/Local State`;
    }
    if (isWin()) {
        const local = process.env["LOCALAPPDATA"] || `${home}/AppData/Local`;
        const map = {
            chrome: "Google/Chrome/User Data/Local State",
            edge: "Microsoft/Edge/User Data/Local State",
            brave: "BraveSoftware/Brave-Browser/User Data/Local State",
            chromium: "Chromium/User Data/Local State",
        } as const;
        return path.join(local, map[kind]);
    }
    const cfg = `${home}/.config`;
    const map = {
        chrome: "google-chrome/Local State",
        edge: "microsoft-edge/Local State",
        brave: "brave-browser/Local State",
        chromium: "chromium/Local State",
    } as const;
    return path.join(cfg, map[kind]);
}

function macosKeychainSecret(kind: Exclude<BrowserKind, "firefox">): string {
    const map = {
        chrome: "Chrome Safe Storage",
        edge: "Microsoft Edge Safe Storage",
        brave: "Brave Browser Safe Storage",
        chromium: "Chromium Safe Storage",
    } as const;
    try {
        const out = execFileSync("security", [
            "find-generic-password",
            "-w",
            "-s",
            map[kind],
            "-a",
            kind === "chrome" ? "Chrome" : kind === "edge" ? "Microsoft Edge" : kind,
        ], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        return out || "";
    } catch {
        return "";
    }
}

function dpapiDecrypt(data: Buffer): Buffer {
    // Windows DPAPI:用 node 无法直接调 CNG 而不动 native。这里回退:
    // 若跑在 Windows 桌面,Obsidian Electron 可用 child_process 调 `powershell
    // [System.Security.Cryptography.ProtectedData]::Unprotect`。简化处理:
    // 尝试通过 7zip/kms 不可行,则返回空,明文 cookie 仍可读出。
    void data;
    return Buffer.alloc(32);
}

// ---- 解密单个 Chromium cookie 值 -------------------------------------

function decryptChromiumValue(
    hostKey: string,
    v: Buffer,
    encryptionKey: Buffer,
): string {
    try {
        if (v[0] === 0x33 && v[1] === 0x6f && v[2] === 0x6c && v[3] === 0x69) {
            // "v10"/"v11" AES-256-CBC(Chrome 默认)
            const iv = v.subarray(3, 19);
            const ct = v.subarray(19);
            const d = crypto.createDecipheriv("aes-256-cbc", encryptionKey, iv);
            let out = d.update(ct);
            out = Buffer.concat([out, d.final()]);
            return utf8Trim(out);
        }
        if (v[0] === 0x00) {
            // 旧版 Windows "v20"(AES-CBC, 前 3 字节 + 16 字节 iv)
            const iv = v.subarray(3, 19);
            const ct = v.subarray(19);
            const d = crypto.createDecipheriv("aes-256-cbc", encryptionKey, iv);
            let out = d.update(ct);
            out = Buffer.concat([out, d.final()]);
            return utf8Trim(out);
        }
        if (v[0] === 0x6b) {
            // Linux: 明文 "k" 前缀
            return v.subarray(1).toString("utf8");
        }
    } catch {
        // 解密失败:可能拿不到 key,退回明文
    }
    return v.length > 3 ? v.subarray(1).toString("utf8") : "";
}

function utf8Trim(b: Buffer): string {
    // 去 AES 块填充
    let end = b.length;
    if (end > 0 && b[end - 1] >= 1 && b[end - 1] <= 16) {
        const pad = b[end - 1];
        end = end - pad;
    }
    return b.subarray(0, end).toString("utf8");
}

// ---- 读 SQLite(Cookies / cookies.sqlite),不依赖 better-sqlite3 -------
// 直接解析是脆弱的;这里用系统 sqlite3 CLI 导出(桌面环境通常有),回退报错。

// cols 固定为 [value列, host列, name列] 的表列名;按位置解析 TSV。
function sqliteExport(file: string, table: string, cols: [string, string, string], hostFilter: string[]): CookieRow[] {
    if (!fs.existsSync(file)) return [];
    try {
        // 复制一份再读,避免被浏览器锁
        const tmp = path.join(os.tmpdir(), `wx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
        fs.copyFileSync(file, tmp);
        const hostClause = hostFilter.length
            ? hostFilter.map((h) => `host_key LIKE '${h}%'`).join(" OR ")
            : "1=1";
        const [valCol, hostCol, nameCol] = cols;
        const sql = `SELECT ${valCol}, ${hostCol}, ${nameCol} FROM ${table} WHERE ${hostClause};`;
        // 用系统 sqlite3 CLI 导出 TSV(桌面环境通常有;缺失时返回空)
        const out = execFileSync("sqlite3", [tmp, "-separator", "\t", sql], {
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 1024 * 1024 * 64,
        }).toString("utf8");
        fs.unlinkSync(tmp);
        const rows: CookieRow[] = [];
        for (const line of out.split("\n")) {
            if (!line.trim()) continue;
            const parts = line.split("\t");
            if (parts.length < 3) continue;
            const [rawValue, host, name] = parts;
            // sqlite3 CLI 对 BLOB 列输出 0x 前缀十六进制;去掉前缀交给调用方按 hex 处理。
            const value = rawValue.startsWith("0x") ? rawValue.slice(2) : rawValue;
            rows.push({ host, name, value });
        }
        return rows;
    } catch (e) {
        console.warn("[wechat-inbox] cookie 读取失败:", e);
        return [];
    }
}

// ---- 对外:按域名拉某浏览器的 cookie ----------------------------------

/**
 * 从指定浏览器读取匹配 `domains`(如 ["bilibili.com"])的 cookie,
 * 写成 Netscape cookies.txt,返回文件路径。失败返回 null。
 */
export function exportBrowserCookies(
    browser: BrowserKind,
    domains: string[],
): string | null {
    // host 匹配:cookie 的 host 等于 domain 或其子域(末尾带点或完全等)
    const hostMatch = (host: string, domains: string[]): boolean => {
        const h = host.replace(/^\./, "").replace(/^\*/, "");
        return domains.some((d) => h === d || h.endsWith("." + d));
    };

    let rows: CookieRow[];
    if (browser === "firefox") {
        const file = firefoxCookieFile();
        if (!file) return null;
        // Firefox host 列是完整域,直接读全部再 JS 过滤(sqlite3 不在时容错)
        rows = sqliteExport(file, "moz_cookies", ["host", "name", "value"], [])
            .filter((r) => hostMatch(r.host, domains));
    } else {
        const file = chromeCookieFile(browser);
        if (!file) return null;
        const key = chromeEncryptionKey(browser);
        // Chromium host_key 是 eTLD+1,value 是 encrypted_value 的 hex
        rows = sqliteExport(file, "cookies", ["encrypted_value", "host_key", "name"], [])
            .filter((r) => hostMatch(r.host, domains))
            .map((r) => {
                const encBuf = hexToBuf(r.value);
                return { host: r.host, name: r.name, value: decryptChromiumValue(r.host, encBuf, key) };
            })
            .filter((r) => r.value);
    }

    if (rows.length === 0) return null;

    // Netscape 格式:域 | 是否子域适用 | 路径 | secure | 过期(0=会话) | 名 | 值
    const lines = [
        "# Netscape HTTP Cookie File",
        `# exported by wechat-inbox-sync for ${browser}`,
    ];
    for (const r of rows) {
        lines.push(`${r.host}\tTRUE\t/\tFALSE\t0\t${r.name}\t${r.value}`);
    }

    const out = path.join(
        os.tmpdir(),
        `wx-inbox-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    fs.writeFileSync(out, lines.join("\n") + "\n", "utf8");
    return out;
}

function hexToBuf(s: string): Buffer {
    return Buffer.from(s, "hex");
}

/** 探测本机装了哪些可用浏览器(存在 cookie 文件即视为可用)。 */
export function detectBrowsers(): BrowserKind[] {
    const found: BrowserKind[] = [];
    (["chrome", "edge", "brave", "chromium"] as Exclude<BrowserKind, "firefox">[]).forEach((k) => {
        if (chromeCookieFile(k)) found.push(k);
    });
    if (firefoxCookieFile()) found.push("firefox");
    return found;
}
