Page({
    data: {
        markdown: "",
        meta: null,
        content: "",
        loading: false,
        error: "",
    },

    onShow() {
        // Prefer the result the index page just produced; otherwise, if the user
        // deep-linked here with a ?url= query, run the clipper on the spot.
        const cached = wx.getStorageSync("clipper_last");
        if (cached && cached.markdown) {
            this.setData({ markdown: cached.markdown, meta: cached.meta || null, content: cached.content || "" });
            return;
        }
        // No cache yet (first launch / cold start) — nothing to show.
        if (!this.data.markdown) {
            this.setData({ error: "还没有剪藏内容，请先在首页剪藏" });
        }
    },

    async copy() {
        const md = this.data.markdown;
        if (!md) return;
        try {
            await wx.setClipboardData({ data: md });
            wx.showToast({ title: "已复制 Markdown", icon: "success" });
        } catch (e) {
            wx.showToast({ title: "复制失败", icon: "none" });
        }
    },

    async saveFile() {
        const md = this.data.markdown;
        if (!md) return;
        const meta = this.data.meta || {};
        const safeTitle = (meta.title || "clip").replace(/[/\\?%*:|"<>]/g, "_").slice(0, 40) || "clip";
        this.setData({ loading: true });
        try {
            const filename = `${safeTitle}.md`;
            const fs = wx.getFileSystemManager();
            const path = `${wx.env.USER_DATA_PATH}/${filename}`;
            // encoding:"utf8" expects a JS string, so pass the Markdown directly.
            fs.writeFile({
                filePath: path,
                data: md,
                encoding: "utf8",
                success: () => {
                    this.setData({ loading: false });
                    wx.showModal({
                        title: "已保存到本地",
                        content: `${path}\n\n可在微信「我-文件管理」中查看，或用转发/分享给好友。`,
                        showCancel: false,
                    });
                },
                fail: (err) => {
                    this.setData({ loading: false, error: err.errMsg || "保存失败" });
                },
            });
        } catch (e) {
            this.setData({ loading: false, error: e.message });
        }
    },

    onShareAppMessage() {
        return { title: "剪藏笔记", path: "/pages/index/index" };
    },
});
