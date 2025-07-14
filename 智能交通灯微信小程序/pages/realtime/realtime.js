// realtime.js

Page({
    data: {
        showPopup: false,
        selectedIntersection: null,
        trafficLights: [],
        timers: {} // 新增定时器存储
    },

    // 显示弹窗
    showIntersectionSelect() {
        this.setData({ showPopup: true });
    },

    // 选择路口
    selectIntersection(e) {
        const id = e.currentTarget.dataset.id;
        this.setData({
            selectedIntersection: id,
            showPopup: false
        }, () => {
            this.getTrafficLights(id);
            this.startTimers(id); // 启动定时器
        });
    },

    // 获取信号灯数据
    getTrafficLights(intersectionId) {
        const self = this;
        const token = wx.getStorageSync('token'); // 取出token
        wx.request({
            url: 'http://localhost:5000/get_traffic_lights', 
            data: { intersection_id: intersectionId },
            header: {
                'Authorization': 'Bearer ' + token // 加上token
            },
            success: (res) => {
                if (res.statusCode === 200 && res.data) {
                    const lights = res.data.map(light => ({
                        id: light.light_id,
                        remainingTime: light.remaining_time,
                        currentState: light.current_status,
                        totalDuration: light.total_duration
                    }));
                    self.setData({ trafficLights: lights });
                } else if (res.statusCode === 401) {
                    wx.showToast({ title: '请先登录', icon: 'none' });
                }
            }
        });
    },
    // 启动倒计时定时器
    startTimers(intersectionId) {
        const self = this;
        // 清除旧定时器
        if (this.data.timers[intersectionId]) {
            clearInterval(this.data.timers[intersectionId]);
        }

        // 新定时器
        const timer = setInterval(() => {
            self.setData({
                trafficLights: self.data.trafficLights.map(light => {
                    const newTime = light.remainingTime > 0 ? light.remainingTime - 1 : 0;
                    // 自动切换状态
                    if (newTime <= 0) {
                        return {
                            ...light,
                            currentState: light.currentState === 'red' ? 'green' : 'red',
                            remainingTime: light.totalDuration,
                            totalDuration: light.currentState === 'red' ? light.totalDuration : light.totalDuration
                        };
                    }
                    return { ...light, remainingTime: newTime };
                })
            });
        }, 1000);

        // 存储定时器引用
        const timers = { ...this.data.timers, [intersectionId]: timer };
        this.setData({ timers });
    },

    // 返回按钮
    goBack() {
        // 清除所有定时器
        Object.values(this.data.timers).forEach(timer => clearInterval(timer));
        this.setData({
            selectedIntersection: null,
            trafficLights: [],
            timers: {}
        });
    }
});


