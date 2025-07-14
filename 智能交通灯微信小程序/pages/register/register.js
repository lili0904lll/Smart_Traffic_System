Page({
    data: {
      username: '',
      password: '',
      email: '',
      phone: ''
    },
    onInput(e) {
      const field = e.currentTarget.dataset.field;
      this.setData({ [field]: e.detail.value });
    },
    register() {
      const { username, password, email, phone } = this.data;
      if (!username || !password || !email || !phone) {
        wx.showToast({ title: '请填写完整信息', icon: 'none' });
        return;
      }
      wx.request({
        url: 'http://localhost:5000/register',
        method: 'POST',
        data: { username, password, email, phone },
        header: { 'content-type': 'application/json' }, // 必须加
        success: (res) => {
            console.log('注册返回内容:', res);
            if (res.data.status === 'success') {
                wx.showToast({ title: '注册成功' });
                wx.redirectTo({ url: '/pages/login/login' });
            } else {
                wx.showToast({ title: res.data.error || '注册失败', icon: 'none' });
            }
        },
        fail: () => wx.showToast({ title: '网络错误', icon: 'none' })
    });
    }
  });