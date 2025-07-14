App({
    // 权限检查，可在需要的页面调用
    checkAuth: function() {
        return new Promise((resolve, reject) => {
            const token = wx.getStorageSync('token');
            if (!token) {
                wx.redirectTo({ url: '/pages/login/login' });
                reject('未登录');
                return;
            }
            wx.request({
                url: 'http://localhost:5000/current_user',
                header: { 'Authorization': `Bearer ${token}` },
                success: (res) => {
                    if (res.data.role && ['admin', 'operator'].includes(res.data.role)) {
                        resolve(true);
                    } else {
                        wx.redirectTo({ url: '/pages/index/index' });
                        reject('权限不足');
                    }
                },
                fail: () => {
                    wx.redirectTo({ url: '/pages/login/login' });
                    reject('验证失败');
                }
            });
        });
    },

    globalData: {
        userInfo: null
    },

    onLaunch() {
        // 展示本地存储能力
        const logs = wx.getStorageSync('logs') || [];
        logs.unshift(Date.now());
        wx.setStorageSync('logs', logs);

        // 检查本地用户信息
        const userInfo = wx.getStorageSync('userInfo');
        if (userInfo) {
            this.globalData.userInfo = userInfo;
        }

        // 微信登录（如需用 openId，可在此发请求）
        wx.login({
            success: res => {
                // 可将 res.code 发送到后台换取 openId, sessionKey, unionId
            }
        });
    }
});