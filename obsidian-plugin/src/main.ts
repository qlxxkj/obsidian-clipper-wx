import {
    App,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    requestUrl,
} from "obsidian";
import { convertText, convertUrl, type ConvertResult } from "./convert";

// ---- 收件箱项(与 Cloudflare worker 的 InboxItem 对齐) -----------------
interface InboxItem {
    id: string;
    code: string;
    url?: string;
    kind?: string;
    content?: string;
    title?: string;
    tag?: string;
    at: number;
}

interface Settings {
    apiBase: string;
    code: string; // 6 位随机码
    intervalMin: number;
    folder: string; // 知识库内写入目录
    confirm: boolean; // 写库前弹确认
}

const DEFAULTS: Settings = {
    apiBase: "https://wechat-inbox.example.workers.dev",
    code: "",
    intervalMin: 5,
    folder: "Clippings",
    confirm: false,
};

export default class WeChatInboxSyncPlugin extends Plugin {
    settings: Settings = { ...DEFAULTS };
    private timer: any = null;
    private syncing = false;

    // 本地内容去重(L2,插件侧补一层,防 KV 去重键过期后重投)
    private seenCache = new Map<string, number>();

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new WeChatInboxSettingsTab(this.app, this));

        this.addRibbonIcon("inbox", "WeChat Inbox: 同步", () => {
            this.syncOnce(true);
        });
        this.addCommand({
            id: "wechat-inbox-sync-now",
            name: "立即同步收件箱",
            callback: () => this.syncOnce(true),
        });

        this.scheduleNextPoll();
    }

    onunload() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    private async loadSettings() {
        const data = await this.loadData();
        if (data && typeof data === "object") Object.assign(this.settings, data);
    }
    saveSettings() {
        void this.saveData(this.settings);
    }

    private scheduleNextPoll() {
        if (this.timer) clearTimeout(this.timer);
        if (this.settings.intervalMin > 0 && this.settings.code) {
            this.timer = setTimeout(() => this.syncOnce(false), this.settings.intervalMin * 60 * 1000);
        }
    }

    // 生成 6 位随机码(首次绑定用)。返回码本身,供设置页展示。
    generateCode(): string {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    private codeHeader(): Record<string, string> {
        return this.settings.code
            ? { Authorization: `Bearer ${this.settings.code}` }
            : {};
    }

    async syncOnce(manual: boolean) {
        if (this.syncing) return;
        const { apiBase, code } = this.settings;
        if (!apiBase || !code) {
            if (manual) new Notice("WeChat Inbox: 请先在设置里填写收件箱地址和 6 位码");
            return;
        }
        this.syncing = true;
        try {
            const items = await this.fetchPending();
            if (items.length === 0) {
                if (manual) new Notice("WeChat Inbox: 暂无待同步内容");
                return;
            }
            let written = 0;
            let deduped = 0;
            for (const item of items) {
                const ok = await this.writeItem(item, manual);
                ok ? written++ : deduped++;
            }
            await this.ack(items.map((i) => i.id), items[0].url, items[0].content);
            new Notice(
                `WeChat Inbox: 同步完成,写 ${written} 条,跳过 ${deduped} 条已存在`,
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (manual) new Notice(`WeChat Inbox: 同步失败 (${msg})`);
            console.error("[wechat-inbox]", msg);
        } finally {
            this.syncing = false;
        }
        this.scheduleNextPoll();
    }

    private async fetchPending(): Promise<InboxItem[]> {
        const res = await requestUrl({
            url: `${this.settings.apiBase.replace(/\/+$/, "")}/v1/pending`,
            method: "GET",
            headers: { ...this.codeHeader(), "content-type": "application/json" },
            throw: false,
        });
        if (res.status !== 200) throw new Error(`pending HTTP ${res.status}`);
        const data = res.json as { ok?: boolean; items?: InboxItem[] };
        if (!data.ok) throw new Error(data?.items ? "unexpected" : "bad response");
        // 从新到旧
        return (data.items ?? []).slice();
    }

    private contentHash(s: string): string {
        let h = 5381;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) + h) ^ s.charCodeAt(i);
        }
        return (h >>> 0).toString(36);
    }

    private isDeduped(key: string, url?: string, content?: string): boolean {
        // 全局 URL 去重:已存在同名文件直接跳过(不覆盖)
        if (url) {
            const exists = this.app.vault.getFiles().some((f) => f.basename === this.basenameFor(url));
            if (exists) return true;
        }
        // 本地内容哈希缓存(L2):同内容不重投
        const now = Date.now();
        const last = this.seenCache.get(key);
        if (last && now - last < 7 * 24 * 3600 * 1000) return true;
        return false;
    }

    private basenameFor(url: string): string {
        try {
            const u = new URL(url);
            const slug = u.pathname
                .split("/")
                .filter(Boolean)
                .pop()
                ?.replace(/\.\w+$/, "") || u.hostname;
            return slug.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "clip";
        } catch {
            return "clip";
        }
    }

    private async writeItem(item: InboxItem, manual: boolean): Promise<boolean> {
        const key = this.contentHash(`${item.url || ""}::${item.content || ""}`);
        if (this.isDeduped(key, item.url, item.content)) return false;

        let markdown: string;
        let title = item.title || "";
        if (item.kind === "text" && item.content) {
            // 纯图文:不联网
            markdown = convertText({ title: item.title, content: item.content, url: item.url, tags: [item.tag || "clippings"] });
        } else if (item.url) {
            // 网页:本地抓取 + Defuddle
            const r: ConvertResult = await convertUrl(item.url, [item.tag || "clippings"]);
            markdown = r.markdown;
            title = r.title || title;
        } else {
            return false; // 既无 url 又无 content,直接丢弃
        }

        const folder = this.ensureFolder(this.settings.folder);
        const base = title ? slugify(title) : this.basenameFor(item.url || `memo-${item.id}`);
        const full = folder ? `${folder}/${base}.md` : `${base}.md`;

        // 再次确认文件不存在(不覆盖)
        const existing = this.vaultFile(full);
        if (existing) return false;

        if (this.settings.confirm && manual) {
            const ok = await new Promise<boolean>((resolve) => {
                const m = new ConfirmModal(this.app, `写入「${full}」?`, () => resolve(true), () => resolve(false));
                m.open();
            });
            if (!ok) return false;
        }
        // 写入
        await this.app.vault.create(full, markdown);
        this.seenCache.set(key, Date.now());
        if (item.url) this.seenCache.set(`u:${item.url}`, Date.now());
        return true;
    }

    private vaultFile(path: string): TFile | null {
        const f = this.app.vault.getAbstractFileByPath(path);
        return f instanceof TFile ? f : null;
    }

    private ensureFolder(folder: string): string {
        if (!folder) return "";
        if (this.app.vault.getAbstractFileByPath(folder)) return folder;
        // createFolder 返回后同步标记;简化:存在性判断即可
        this.app.vault.createFolder(folder).catch(() => {});
        return folder;
    }

    private async ack(ids: string[], url?: string, content?: string) {
        if (ids.length === 0) return;
        await requestUrl({
            url: `${this.settings.apiBase.replace(/\/+$/, "")}/v1/ack`,
            method: "POST",
            headers: { ...this.codeHeader(), "content-type": "application/json" },
            body: JSON.stringify({ ids, url, content }),
            throw: false,
        });
    }
}

// ---- 确认弹窗 ---------------------------------------------------------

class ConfirmModal extends Modal {
    private msg: string;
    private yes: () => void;
    private no: () => void;
    constructor(app: App, msg: string, yes: () => void, no: () => void) {
        super(app);
        this.msg = msg;
        this.yes = yes;
        this.no = no;
    }
    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("p", { text: this.msg });
        const row = contentEl.createDiv();
        new Setting(row)
            .addButton((b) => b.setButtonText("写入").setCta().onClick(() => { this.close(); this.yes(); }))
            .addButton((b) => b.setButtonText("取消").onClick(() => { this.close(); this.no(); }));
    }
}

// ---- 设置页 -----------------------------------------------------------

class WeChatInboxSettingsTab extends PluginSettingTab {
    plugin: WeChatInboxSyncPlugin;
    constructor(app: App, plugin: WeChatInboxSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        const s = this.plugin.settings;

        new Setting(containerEl)
            .setName("收件箱地址 (HTTPS Worker)")
            .setDesc("Cloudflare Worker 部署地址,末尾带 / 会被自动去掉")
            .addText((t) =>
                t.setValue(s.apiBase).onChange((v) => {
                    s.apiBase = v.trim();
                    this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName("设备码 (6 位)")
            .setDesc("小程序里也填这个码,作为身份 token 投内容。点右侧按钮生成。")
            .addText((t) =>
                t
                    .setPlaceholder("如 123456")
                    .setValue(s.code)
                    .onChange((v) => {
                        s.code = v.trim();
                        this.plugin.saveSettings();
                    }),
            )
            .addButton((b) =>
                b.setButtonText("生成").setTooltip("生成新的 6 位随机码").onClick(() => {
                    const code = this.plugin.generateCode();
                    s.code = code;
                    this.plugin.saveSettings();
                    this.display();
                    new Notice(`已生成设备码:${code}`);
                }),
            );

        new Setting(containerEl)
            .setName("同步间隔 (分钟)")
            .setDesc("0 = 只手动同步(点左侧收件箱图标或命令面板)")
            .addText((t) =>
                t.setValue(String(s.intervalMin)).onChange((v) => {
                    s.intervalMin = Math.max(0, parseInt(v, 10) || 0);
                    this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName("写入目录")
            .setDesc("相对知识库根目录,如 Clippings")
            .addText((t) =>
                t.setValue(s.folder).onChange((v) => {
                    s.folder = v.trim();
                    this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName("写库前确认")
            .setDesc("开启后,手动同步前逐条弹确认(自动同步不受影响)")
            .addToggle((tg) =>
                tg.setValue(s.confirm).onChange((v) => {
                    s.confirm = v;
                    this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl).addButton((b) =>
            b.setButtonText("立即同步").setTooltip("现在拉取并写入收件箱内容").onClick(() => {
                this.plugin.syncOnce(true);
            }),
        );
    }
}

function slugify(s: string): string {
    return s.replace(/[[\]{}()/\\]"<>:*?]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "clip";
}
