// pages/trafficflow/trafficflow.js
Page({
        data: {
            intersectionId: null,
            trafficFlowData: []
        },
        onLoad(options) {
            const intersectionId = options.intersectionId;
            this.setData({ intersectionId });
            this.getTrafficFlowData(intersectionId);
        },
        getTrafficFlowData(intersectionId) {
            wx.request({
                url: 'http://localhost:5000/get_traffic_flow',
                data: { intersection_id: intersectionId },
                success: (res) => {
                    const trafficFlowData = res.data.map(item => ({
                        time_period: item.time_period,
                        average_flow: item.flow_count // 假设后端返回的字段是 flow_count
                    }));
                    this.setData({ trafficFlowData });
                },
                fail: (err) => {
                    console.error('Failed to fetch traffic flow data:', err);
                    wx.showToast({ title: '加载失败', icon: 'none' });
                }
            });
        }
    });

