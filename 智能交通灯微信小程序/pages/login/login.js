Page({
    data: {
      username: '',
      password: '',
      captchaCode: '',
      captchaValue: '',
      captchaImage: null
    },
  
    onLoad() {
      this.refreshCaptcha();
    },
  
    generateCaptcha() {
      const chars = '0123456789';
      let result = '';
      for (let i = 0; i < 4; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    },
  
    generateCaptchaImage(captcha) {
      return new Promise((resolve) => {
        const ctx = wx.createCanvasContext('captchaCanvas');
        const canvasWidth = 140;
        const canvasHeight = 45;
        
        // 绘制动态背景 - 多种不同灰度的矩形叠加
        for (let i = 0; i < 5; i++) {
          ctx.setFillStyle(`rgb(${Math.random() * 55 + 180},${Math.random() * 55 + 180},${Math.random() * 55 + 180})`);
          ctx.fillRect(
            Math.random() * 30,
            Math.random() * 10,
            canvasWidth - Math.random() * 40,
            canvasHeight - Math.random() * 20
          );
        }
        
        // 绘制复杂干扰线
        const lineColors = ['#333', '#555', '#777', '#999'];
        for (let i = 0; i < 12; i++) {
          ctx.beginPath();
          ctx.setLineWidth(0.7 + Math.random());
          ctx.setStrokeStyle(lineColors[Math.floor(Math.random() * lineColors.length)]);
          ctx.setLineDash([2, 3 + Math.floor(Math.random() * 5)]);
          
          // 创建波浪线效果
          const startX = Math.random() * canvasWidth;
          const startY = Math.random() * canvasHeight;
          ctx.moveTo(startX, startY);
          
          // 波浪线条
          for (let j = 0; j < 3; j++) {
            const waveX = startX + (j + 1) * (10 + Math.random() * 20);
            const waveY = startY + (Math.random() - 0.5) * 25;
            ctx.lineTo(waveX, waveY);
          }
          ctx.stroke();
        }
        
        // 绘制干扰点 - 随机位置、随机大小、随机透明度的点阵
        for (let i = 0; i < 80; i++) {
          ctx.beginPath();
          ctx.arc(
            Math.random() * canvasWidth,
            Math.random() * canvasHeight,
            0.5 + Math.random() * 2,
            0,
            Math.PI * 2
          );
          ctx.setFillStyle(`rgba(0,0,0,${0.2 + Math.random() * 0.4})`);
          ctx.fill();
        }
        
        // 绘制扭曲数字
        ctx.setFontSize(28 + Math.random() * 4);
        ctx.setTextBaseline('middle');
        
        for (let i = 0; i < captcha.length; i++) {
          // 每个字符单独设置颜色和变形
          const colorValue = 40 + Math.floor(Math.random() * 60);
          ctx.setFillStyle(`rgb(${colorValue},${colorValue},${colorValue})`);
          
          const baseX = 15 + i * 30;
          const baseY = canvasHeight / 2;
          
          // 随机角度旋转（最大±40度）
          const rotation = Math.random() * 0.7 - 0.35;
          
          // 随机缩放（0.8-1.2倍）
          const scale = 0.8 + Math.random() * 0.4;
          
          // 随机位置偏移（±5像素）
          const offsetX = Math.random() * 8 - 4;
          const offsetY = Math.random() * 8 - 4;
          
          // 透视变形 - 使用矩阵变换
          const shearX = Math.random() * 0.2 - 0.1;
          
          // 保存当前状态
          ctx.save();
          
          // 应用所有变形
          ctx.translate(baseX + offsetX, baseY + offsetY);
          ctx.rotate(rotation);
          ctx.transform(scale, shearX, 0, scale, 0, 0);
          
          // 绘制字符
          ctx.fillText(captcha[i], 0, 0);
          
          // 恢复状态
          ctx.restore();
        }
        
        // 添加边框
        ctx.setStrokeStyle('#ccc');
        ctx.strokeRect(0, 0, canvasWidth, canvasHeight);
        
        // 生成图片
        ctx.draw(false, () => {
          wx.canvasToTempFilePath({
            canvasId: 'captchaCanvas',
            success: (res) => {
              resolve(res.tempFilePath);
            },
            fail: () => {
              resolve('');
            }
          });
        });
      });
    },
  
    async refreshCaptcha() {
      wx.showLoading({ title: '验证码生成中...' });
      
      const captcha = this.generateCaptcha();
      const imageData = await this.generateCaptchaImage(captcha);
      
      this.setData({
        captchaValue: captcha,
        captchaImage: imageData,
        captchaCode: '' // 清空验证码输入框
      }, () => {
        wx.hideLoading();
      });
    },
  
    onInput(e) {
      const field = e.currentTarget.dataset.field;
      this.setData({ [field]: e.detail.value });
    },
  
    login() {
      const { username, password, captchaCode, captchaValue } = this.data;
      
      if (!username) {
        this.showErrorToast('请输入账号');
        return;
      }
      
      if (!password) {
        this.showErrorToast('请输入密码');
        return;
      }
      
      if (!captchaCode) {
        this.showErrorToast('请输入验证码');
        return;
      }
      
      if (captchaCode !== captchaValue) {
        this.showErrorToast('验证码错误');
        this.refreshCaptcha();
        return;
      }
  
      wx.showLoading({ title: '登录中...', mask: true });
  
      const _this = this;
  
      wx.request({
        url: 'http://localhost:5000/login',
        method: 'POST',
        data: {
          username: username.trim(),
          password: password.trim()
        },
        header: { 'content-type': 'application/json' },
        success: function(res) {
          console.log('登录返回内容:', res);
          console.log('登录返回data:', res.data);
          wx.hideLoading();
          if (res.statusCode === 200 && res.data.status === 'success') {
            const userInfo = {
              ...res.data.user_info,
              isAdmin: res.data.user_info.user_type === 'admin',
              isOperator: res.data.user_info.user_type === 'operator'
            }
            _this.handleLoginSuccess(userInfo, res.data.token);
          } else {
            const errMsg = res.data.error || '登录失败';
            _this.showErrorToast(errMsg);
            _this.refreshCaptcha();
          }
        },
        fail: function(err) {
          wx.hideLoading();
          _this.showErrorToast('网络连接失败');
          _this.refreshCaptcha();
        }
      });
    },
  
    handleLoginSuccess(userInfo, token) {
      wx.setStorageSync('userInfo', userInfo);
      wx.setStorageSync('token', token);
  
      const targetUrl = '/pages/index/index';
  
      wx.showToast({
        title: '登录成功',
        icon: 'success',
        duration: 1500,
        complete: () => {
          setTimeout(() => {
            wx.switchTab({
              url: targetUrl,
              success: () => {
                const pages = getCurrentPages();
                if (pages.length > 0) {
                  pages[0].onLoad();
                }
              }
            });
          }, 1500);
        }
      });
    },
  
    showErrorToast(msg) {
      wx.showToast({
        title: msg,
        icon: 'none',
        duration: 2000
      });
    },
  
    goToRegister() {
      wx.navigateTo({
        url: '/pages/register/register'
      });
    }
  });