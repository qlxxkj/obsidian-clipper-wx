// 薄收件箱客户端。小程序只做一件事:把 链接/图文 + 6位设备码 投到 Cloudflare
// 收件箱 Worker;转换/写库全在桌面 Obsidian 插件里完成。
//
// 注意(微信):Worker 的 HTTPS 域必须加白(小程序后台 request 合法域名),
// 开发期 devtools 勾「不校验合法域名」可用本地/测试地址。

function getAppGlobal() {
    return getApp().globalData;
}

function base() {
    const g = getAppGlobal();
    return (g.inbox || wx.getStorageSync("clipper_inbox") || "").replace(/\/+$/, "");
}

function code() {
    const g = getAppGlobal();
    return g.code || wx.getStorageSync("clipper_code") || "";
}

// 投递一条到收件箱:{ kind, url?, content?, title?, tag? }
function claim(payload) {
    return new Promise((resolve, reject) => {
        const host = base();
        const c = code();
        if (!host) {
            reject(new Error("请先在「设置」里填写收件箱地址 (Worker)"));
            return;
        }
        if (!/^\d{6}$/.test(c)) {
            reject(new Error("请先在「设置」里填写 6 位设备码"));
            return;
        }
        const url = `${host}/v1/claim?code=${c}`;
        wx.request({
            url,
            method: "POST",
            data: payload,
            header: { "content-type": "application/json" },
            timeout: 20000,
            success: (res) => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(res.data); // { ok, id?, deduped?, queued? }
                } else {
                    const msg = (res.data && res.data.error) || `HTTP ${res.statusCode}`;
                    reject(new Error(msg));
                }
            },
            fail: (err) => {
                reject(new Error(err.errMsg || "网络请求失败"));
            },
        });
    });
}

module.exports = { claim };
