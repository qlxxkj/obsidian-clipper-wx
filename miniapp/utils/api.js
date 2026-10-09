// Thin client for the clipper-backend. The Mini Program does NO conversion
// itself — it only sends a URL (or pure content) and receives Markdown back.
//
// IMPORTANT (WeChat): your backend host must be a registered, whitelisted
// HTTPS domain in the Mini Program admin console (request 合法域名).
// In dev you can tick "不校验合法域名" in devtools to use http://127.0.0.1.

function getAppGlobal() {
    return getApp().globalData;
}

function base() {
    const g = getAppGlobal();
    return (g.backend || wx.getStorageSync("clipper_backend") || "").replace(/\/+$/, "");
}

function headers() {
    const g = getAppGlobal();
    const token = g.token || wx.getStorageSync("clipper_token");
    const h = { "content-type": "application/json" };
    if (token) h["x-clipper-token"] = token;
    return h;
}

function request(path, payload) {
    return new Promise((resolve, reject) => {
        const host = base();
        if (!host) {
            reject(new Error("请先在「设置」里填写后端地址 (backend)"));
            return;
        }
        wx.request({
            url: `${host}${path}`,
            method: "POST",
            data: payload,
            header: headers(),
            timeout: 40000,
            success: (res) => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(res.data);
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

// URL clipper path: { url, tags?, template?, selector?, language? }
function clipUrl(payload) {
    return request("/clip", payload);
}

// Pure-content path: { content, title?, url?, description?, tags?, frontmatter?, template? }
function clipPure(payload) {
    return request("/clip/pure", payload);
}

module.exports = { clipUrl, clipPure };
