const { clipUrl, clipPure } = require("../../utils/api.js");

Page({
    data: {
        mode: "url", // "url" | "pure"
        url: "",
        pureTitle: "",
        pureContent: "",
        tags: "",
        submitting: false,
        error: "",
        notice: "",
    },

    setMode(e) {
        this.setData({ mode: e.currentTarget.dataset.mode, error: "", notice: "" });
    },

    onUrlInput(e) {
        this.setData({ url: e.detail.value, error: "" });
    },
    onPureTitle(e) {
        this.setData({ pureTitle: e.detail.value });
    },
    onPureContent(e) {
        this.setData({ pureContent: e.detail.value });
    },
    onTags(e) {
        this.setData({ tags: e.detail.value });
    },

    parseTags() {
        return this.data.tags
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean);
    },

    async submit() {
        const { mode, url, pureTitle, pureContent, submitting } = this.data;
        if (submitting) return;

        if (mode === "url" && !/^https?:\/\//i.test(url.trim())) {
            this.setData({ error: "请输入完整的 http(s) 链接" });
            return;
        }
        if (mode === "pure" && !pureContent.trim()) {
            this.setData({ error: "请输入要剪藏的图文内容" });
            return;
        }

        this.setData({ submitting: true, error: "", notice: mode === "url" ? "正在抓取并转换…" : "正在生成笔记…" });
        const tags = this.parseTags();
        try {
            let result;
            if (mode === "url") {
                result = await clipUrl({ url: url.trim(), tags });
            } else {
                result = await clipPure({
                    content: pureContent,
                    title: pureTitle || undefined,
                    url: url || undefined,
                    tags,
                });
            }
            wx.setStorageSync("clipper_last", {
                markdown: result.markdown,
                meta: result.meta || null,
                content: result.content,
                at: Date.now(),
            });
            this.setData({ submitting: false, notice: "转换完成" });
            wx.navigateTo({ url: "/pages/preview/preview" });
        } catch (error) {
            this.setData({ submitting: false, notice: "" });
            this.setData({ error: error.message || "转换失败" });
        }
    },
});
