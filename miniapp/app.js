App({
    globalData: {
        backend: "",
        token: "",
    },
    onLaunch() {
        const backend = wx.getStorageSync("clipper_backend") || "";
        const token = wx.getStorageSync("clipper_token") || "";
        this.globalData.backend = backend;
        this.globalData.token = token;
    },
});
