// pages/control/control.js
Page({
    data: {
      workerId: '',
      password: '',
      isLoggedIn: false,
      showIntersectionSelect: false,
      intersections: Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        name: `路口${i + 1}`
      })),
      selectedIntersection: null,
      trafficLights: []
    },
  
    onWorkerIdInput(e) {
      this.setData({ workerId: e.detail.value });
    },
  
    onPasswordInput(e) {
      this.setData({ password: e.detail.value });
    },
  
    login() {
        const { workerId, password } = this.data;
        if (!workerId || !password) {
          wx.showToast({ title: '请输入工号和密码', icon: 'none' });
          return;
        }
      
        wx.showLoading({ title: '身份验证中...', mask: true });
        
        wx.request({
          url: 'http://localhost:5000/staff_login', // 指向新接口
          method: 'POST',
          header: {
            'Content-Type': 'application/json'
          },
          data: {
            employee_id: workerId.trim(), // 参数名修正
            password: password.trim()
          },
          success: (res) => {
            wx.hideLoading();
            if (res.data.status === 'success') {
              // 保存工作人员专用token
              wx.setStorageSync('staff_token', res.data.token);
              this.setData({ 
                isLoggedIn: true,
                userInfo: res.data.user_info
              });
            } else {
              wx.showToast({
                title: res.data.error || '认证失败',
                icon: 'none',
                duration: 2000
              });
            }
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '连接控制台失败', icon: 'none' });
          }
        });
      },
  
    selectIntersection(e) {
      const id = e.currentTarget.dataset.id;
      this.setData({
        selectedIntersection: id,
        showIntersectionSelect: false
      });
      this.getTrafficLights(id);
    },
  
    getTrafficLights(intersectionId) {
        const that = this;
        wx.showLoading({ title: '加载中...' });
        
        // 从存储中获取工作人员token
        const token = wx.getStorageSync('staff_token');
        
        wx.request({
          url: 'http://localhost:5000/get_traffic_lights',
          data: { intersection_id: intersectionId },
          header: {
            'Authorization': 'Bearer ' + token  // 添加认证头
          },
          success: (res) => {
            if (res.statusCode === 200) {
              that.setData({
                trafficLights: res.data.map(item => ({
                  ...item,
                  current_status: item.current_status === 'red' ? 0 : 1
                }))
              });
            } else if (res.statusCode === 401) {
              wx.showToast({ title: '请重新登录', icon: 'none' });
              that.setData({ isLoggedIn: false });
            }
          },
          complete: () => wx.hideLoading()
        });
      },
      
  
    switchIntersection() {
      this.setData({ showIntersectionSelect: true });
    },
  
    goBack() {
        if (this.data.isLoggedIn) {
          // 退出登录状态，返回登录界面
          this.setData({
            isLoggedIn: false,
            workerId: '',
            password: '',
            selectedIntersection: null,
            trafficLights: [],
            showIntersectionSelect: false
          });
        } else {
          // 正常页面返回逻辑
          const pages = getCurrentPages();
          if (pages.length > 1) {
            wx.navigateBack({ delta: 1 });
          } else {
            wx.switchTab({
              url: '/pages/index/index'
            });
          }
        }
      },
  
    onRedDurationInput(e) {
      const { id } = e.currentTarget.dataset;
      const value = e.detail.value;
      this.setData({
        trafficLights: this.data.trafficLights.map(light => 
          light.light_id === id ? { ...light, red_duration: value } : light
        )
      });
    },
  
    onGreenDurationInput(e) {
      const { id } = e.currentTarget.dataset;
      const value = e.detail.value;
      this.setData({
        trafficLights: this.data.trafficLights.map(light => 
          light.light_id === id ? { ...light, green_duration: value } : light
        )
      });
    },
  
    onStatusChange(e) {
      const { id } = e.currentTarget.dataset;
      const value = e.detail.value[0];
      this.setData({
        trafficLights: this.data.trafficLights.map(light => 
          light.light_id === id ? { ...light, current_status: value } : light
        )
      });
    },
  
    saveChanges() {
      const { selectedIntersection, trafficLights } = this.data;
      if (!selectedIntersection) {
        wx.showToast({ title: '请先选择路口', icon: 'none' });
        return;
      }
  
      const updates = trafficLights.map(light => ({
        intersection_id: selectedIntersection,
        light_id: light.light_id,
        red_duration: parseInt(light.red_duration) || 30,
        green_duration: parseInt(light.green_duration) || 30,
        current_status: light.current_status === 0 ? 'red' : 'green'
      }));
      const token = wx.getStorageSync('staff_token');
      wx.showLoading({ title: '保存中...' });
      wx.request({
        url: 'http://localhost:5000/batch_update_traffic_lights',
        method: 'POST',
        header: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token  // 添加认证头
          },
        data: { updates },
        success: (res) => {
          if (res.data.status === 'success') {
            wx.showToast({ title: '保存成功', icon: 'success' });
            this.getTrafficLights(selectedIntersection);
          } else {
            wx.showToast({ title: '保存失败', icon: 'none' });
          }
        },
        complete: () => wx.hideLoading()
      });
    }
  });