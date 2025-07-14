Page({
    data: {
        userInfo: null,
        intersections: Array.from({ length: 15 }, (_, i) => ({ id: i + 1 })),
        markers: [],
        ambulancePositions: [
            { latitude: 39.9, longitude: 116.3 },
            { latitude: 39.91, longitude: 116.31 }
        ],
        fireTruckPositions: [
            { latitude: 39.92, longitude: 116.32 }
        ],
        showMapImage: false,
        mapImagePath: ''
    },
    onShow() {
        // 每次页面显示时检查用户状态
        this.checkAuthStatus();
        this.loadInitialData();
      },
    
      checkAuthStatus() {
        const token = wx.getStorageSync('token');
        if (!token) {
          wx.redirectTo({
            url: '/pages/login/login'
          });
        }
      },
    
      loadInitialData() {
        const app = getApp();
        this.setData({
          userInfo: app.globalData.userInfo || {}
        })},

    onLoad() {
        this.loadMapData();
        // 可选：如需定时移动车辆
        // setInterval(() => this.moveVehicles(), 1000);
    },

    showAll() {
        wx.request({
            url: 'http://localhost:5001/get_traffic_map',
            responseType: 'arraybuffer',
            success: (res) => {
                const tempFilePath = wx.env.USER_DATA_PATH + '/traffic_map.png';
                wx.getFileSystemManager().writeFile({
                    filePath: tempFilePath,
                    data: res.data,
                    encoding: 'binary',
                    success: () => {
                        this.setData({
                            showMapImage: true,
                            mapImagePath: tempFilePath
                        });
                    },
                    fail: (writeErr) => {
                        console.error('文件写入失败', writeErr);
                        wx.showToast({
                            title: '文件写入失败',
                            icon: 'none'
                        });
                    }
                });
            },
            fail: (requestErr) => {
                console.error('获取图像失败', requestErr);
                wx.showToast({
                    title: '获取图像失败',
                    icon: 'none'
                });
            }
        });
    },

    loadMapData() {
        const markers = [];
        for (let i = 1; i <= 15; i++) {
            markers.push({
                id: i,
                latitude: 39.9 + Math.random() * 0.1,
                longitude: 116.3 + Math.random() * 0.1,
                iconPath: "D:\\python object\\MAP\\traffic_map.png", // 本地图片路径，建议用相对路径或网络图片
                width: 30,
                height: 30
            });
        }
        this.setData({ markers });
    },

    moveVehicles() {
        const ambulancePositions = this.data.ambulancePositions.map(pos => ({
            latitude: pos.latitude + Math.random() * 0.001 - 0.0005,
            longitude: pos.longitude + Math.random() * 0.001 - 0.0005
        }));
        const fireTruckPositions = this.data.fireTruckPositions.map(pos => ({
            latitude: pos.latitude + Math.random() * 0.001 - 0.0005,
            longitude: pos.longitude + Math.random() * 0.001 - 0.0005
        }));
        this.setData({
            ambulancePositions,
            fireTruckPositions
        });
    },

    goToHistory() {
        wx.navigateTo({ url: '/pages/history/history' });
    },
    goToRealTime() {
        wx.navigateTo({ url: '/pages/realtime/realtime' });
    },
    goToFeedback() {
        wx.navigateTo({ url: '/pages/feedback/feedback' });
    },
    goToControl() {
        wx.navigateTo({ url: '/pages/control/control' });
    }
});

