const { claim } = require("../../utils/api.js");

Page({
    data: {
        mode: "url", // "url" | "text"
        url: "",
        textTitle: "",
        textContent: "",
        tag: "clippings",
        submitting: false,
        error: "",
        notice: "",
        lastId: "",
    },

    setMode(e) {
        this.setData({ mode: e.currentTarget.dataset.mode, error: "", notice: "" });
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
                ? { kind: "url", url: url.trim(), tag: this.parseTag() }
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
            this.setData({
                submitting: false,
                lastId: id,
                notice: `已投收件箱${id ? " · " + id : ""}${deduped}。桌面端 Obsidian 插件会拉取并写入。`,
            });
        } catch (error) {
            this.setData({ submitting: false, notice: "" });
            this.setData({ error: error.message || "投递失败" });
        }
    },
});
