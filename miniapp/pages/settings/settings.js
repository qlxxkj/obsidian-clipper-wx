Page({
    data: {
        backend: "",
        token: "",
        saved: false,
    },

    onShow() {
        this.setData({
            backend: wx.getStorageSync("clipper_backend") || "",
            token: wx.getStorageSync("clipper_token") || "",
            saved: false,
        });
    },

    onBackend(e) {
        this.setData({ backend: e.detail.value, saved: false });
    },
    onToken(e) {
        this.setData({ token: e.detail.value, saved: false });
    },

    save() {
        const { backend, token } = this.data;
        if (backend && !/^https?:\/\//i.test(backend.trim())) {
            wx.showToast({ title: "后端地址需以 http(s):// 开头", icon: "none" });
            return;
        }
        wx.setStorageSync("clipper_backend", backend.trim().replace(/\/+$/, ""));
        wx.setStorageSync("clipper_token", token.trim());
        const app = getApp();
        app.globalData.backend = backend.trim().replace(/\/+$/, "");
        app.globalData.token = token.trim();
        this.setData({ saved: true });
        wx.showToast({ title: "已保存", icon: "success" });
    },

    test() {
        const { backend } = this.data;
        if (!backend) {
            wx.showToast({ title: "请先填写后端地址", icon: "none" });
            return;
        }
        const token = this.data.token.trim();
        const url = backend.replace(/\/+$/, "") + "/health";
        wx.request({
            url,
            method: "GET",
            header: token ? { "x-clipper-token": token } : {},
            timeout: 10000,
            success: (res) => {
                wx.showToast({
                    title: res.statusCode === 200 ? "连接成功" : `HTTP ${res.statusCode}`,
                    icon: "success",
                });
            },
            fail: (err) => {
                wx.showModal({
                    title: "连接失败",
                    content:
                        `${err.errMsg || "网络错误"}\n\n发布前请确认该域名已在小程序后台「request 合法域名」中加白（HTTPS）。开发阶段可在 devtools 勾选「不校验合法域名」使用本地地址。`,
                    showCancel: false,
                });
            },
        });
    },
});
