App({
    globalData: {
        inbox: "",
        code: "",
    },
    onLaunch() {
        this.globalData.inbox = wx.getStorageSync("clipper_inbox") || "";
        this.globalData.code = wx.getStorageSync("clipper_code") || "";
    },
});
