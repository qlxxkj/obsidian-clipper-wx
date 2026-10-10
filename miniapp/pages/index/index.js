const { claim } = require("../../utils/api.js");
const { parseClipboard } = require("../../utils/clipboard.js");

Page({
    data: {
        mode: "url", // "url" | "video" | "text"
        url: "",
        textTitle: "",
        textContent: "",
        tag: "clippings",
        submitting: false,
        error: "",
        notice: "",
        lastId: "",
        clipboard: "", // 读到的原始剪贴板(展示 + 手动粘贴)
        clipboardHint: "", // 视频链接提示
        autoFilled: false, // 本次自动填过
    },

    onShow() {
        // 每次进页面读一次剪贴板,自动填链接/视频
        this.fillFromClipboard(true);
    },

    setMode(e) {
        this.setData({ mode: e.currentTarget.dataset.mode, error: "", notice: "" });
    },

    async fillFromClipboard(auto) {
        const parsed = await parseClipboard();
        if (!parsed) {
            if (auto) this.setData({ clipboard: "", autoFilled: false });
            return;
        }
        // 有链接(视频/网页)→ 切 url 模式;纯文本 → 切 text 模式
        const targetMode = parsed.kind === "text" ? "text" : "url";
        const patch = {
            mode: targetMode,
            clipboard: parsed.content || parsed.url || "",
            autoFilled: auto,
            error: "",
        };
        if (parsed.url) {
            patch.url = parsed.url;
            // 视频链接:提示这是视频(桌面插件会下载+抽字幕)
            patch.clipboardHint = parsed.kind === "video" ? "视频链接:桌面插件会本地下载并抽字幕" : "";
        }
        if (parsed.content) patch.textContent = parsed.content;
        this.setData(patch);
    },
    onPaste() {
        // 手动粘贴:重新读剪贴板(应对自动读取被拒/剪贴板变了)
        this.fillFromClipboard(false);
    },
    onUrlInput(e) {
        this.setData({ url: e.detail.value, error: "" });
    },
    onTextTitle(e) {
        this.setData({ textTitle: e.detail.value });
    },
    onTextContent(e) {
        this.setData({ textContent: e.detail.value });
    },
    onTag(e) {
        this.setData({ tag: e.detail.value });
    },

    parseTag() {
        const first = (this.data.tag.trim() || "clippings").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        return first[0] || "clippings";
    },

    /** 按当前 url 判断投递 kind:视频平台 → video,其余网页 → url。 */
    urlKind(url) {
        const { isVideoUrl } = require("../../utils/clipboard.js");
        return isVideoUrl(url) ? "video" : "url";
    },

    async submit() {
        const { mode, url, textContent, submitting } = this.data;
        if (submitting) return;

        if (mode === "url" && !/^https?:\/\//i.test(url.trim())) {
            this.setData({ error: "请输入完整的 http(s) 链接" });
            return;
        }
        if (mode === "text" && !textContent.trim()) {
            this.setData({ error: "请输入要剪藏的图文内容" });
            return;
        }

        const payload =
            mode === "url"
                ? { kind: this.urlKind(url.trim()), url: url.trim(), tag: this.parseTag() }
                : {
                      kind: "text",
                      url: url.trim() || undefined,
                      title: this.data.textTitle || undefined,
                      content: textContent,
                      tag: this.parseTag(),
                  };

        this.setData({ submitting: true, error: "", notice: "正在投到收件箱…" });
        try {
            const res = await claim(payload);
            const id = res && res.id ? String(res.id).slice(0, 8) : "";
            const deduped = res && res.deduped ? "（已存在，跳过）" : "";
            const kindNote =
                payload.kind === "video" ? " 视频会本地下载+抽字幕" : "";
            this.setData({
                submitting: false,
                lastId: id,
                notice: `已投收件箱${id ? " · " + id : ""}${deduped}。桌面端 Obsidian 插件会拉取并写入。${kindNote}`,
            });
        } catch (error) {
            this.setData({ submitting: false, notice: "" });
            this.setData({ error: error.message || "投递失败" });
        }
    },
});
