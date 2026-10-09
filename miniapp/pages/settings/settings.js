Page({
    data: {
        inbox: "",
        code: "",
        saved: false,
    },

    onShow() {
        this.setData({
            inbox: wx.getStorageSync("clipper_inbox") || "",
            code: wx.getStorageSync("clipper_code") || "",
            saved: false,
        });
    },

    onInbox(e) {
        this.setData({ inbox: e.detail.value, saved: false });
    },
    onCode(e) {
        this.setData({ code: e.detail.value.replace(/\D/g, "").slice(0, 6), saved: false });
    },

    save() {
        const { inbox, code } = this.data;
        if (inbox && !/^https?:\/\//i.test(inbox.trim())) {
            wx.showToast({ title: "收件箱地址需以 http(s):// 开头", icon: "none" });
            return;
        }
        if (!/^\d{6}$/.test(code)) {
            wx.showToast({ title: "设备码必须是 6 位数字", icon: "none" });
            return;
        }
        const cleaned = inbox.trim().replace(/\/+$/, "");
        wx.setStorageSync("clipper_inbox", cleaned);
        wx.setStorageSync("clipper_code", code);
        const app = getApp();
        app.globalData.inbox = cleaned;
        app.globalData.code = code;
        this.setData({ saved: true });
        wx.showToast({ title: "已保存", icon: "success" });
    },

    test() {
        const { inbox, code } = this.data;
        if (!inbox) {
            wx.showToast({ title: "请先填写收件箱地址", icon: "none" });
            return;
        }
        if (!/^\d{6}$/.test(code)) {
            wx.showToast({ title: "请先填写 6 位设备码", icon: "none" });
            return;
        }
        // GET /v1/pending?code= 只用来探连通性(空队列也返回 ok)。
        wx.request({
            url: `${inbox.replace(/\/+$/, "")}/v1/pending?code=${code}`,
            method: "GET",
            timeout: 10000,
            success: (res) => {
                const ok = res.data && res.data.ok === true;
                wx.showToast({ title: ok ? "连接成功" : `HTTP ${res.statusCode}`, icon: ok ? "success" : "none" });
            },
            fail: (err) => {
                wx.showModal({
                    title: "连接失败",
                    content:
                        `${err.errMsg || "网络错误"}\n\n发布前请确认该 Worker 域已在小程序后台「request 合法域名」加白(HTTPS)。开发期可在 devtools 勾「不校验合法域名」。`,
                    showCancel: false,
                });
            },
        });
    },
});
