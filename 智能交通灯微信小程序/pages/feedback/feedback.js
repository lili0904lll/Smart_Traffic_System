// pages/feedback/feedback.js
Page({
    data: {
        feedbackTypes: ['过路口', '事故发生'],
        intersections: Array.from({ length: 15 }, (_, i) => ({ id: i + 1 })),
        selectedFeedbackType: null,
        selectedIntersection: null,
        feedbackText: '',
        selectedLight: null
    },

    goBack() {
        if (this.data.selectedIntersection) {
            this.setData({ selectedIntersection: null });
        } else if (this.data.selectedFeedbackType) {
            this.setData({ selectedFeedbackType: null });
        } else {
            wx.navigateBack();
        }
    },

    onFeedbackTypeSelect(e) {
        this.setData({ 
            selectedFeedbackType: e.currentTarget.dataset.type 
        });
    },

    onIntersectionSelect(e) {
        this.setData({ 
            selectedIntersection: e.currentTarget.dataset.id 
        });
    },

    onFeedbackTextChange(e) {
        this.setData({ 
            feedbackText: e.detail.value 
        });
    },

    onLightSelect(e) {
        this.setData({ 
            selectedLight: e.currentTarget.dataset.light.toString() 
        });
    },

    submitFeedback() {
        const { 
            selectedFeedbackType, 
            selectedIntersection, 
            feedbackText, 
            selectedLight 
        } = this.data;

        // 基础校验
        const validations = [
            [!selectedFeedbackType, '请选择反馈类型'],
            [!selectedIntersection, '请选择路口'],
            [selectedFeedbackType === '过路口' && !selectedLight, '请选择信号灯'],
            [selectedFeedbackType === '事故发生' && feedbackText.trim().length < 5, '描述至少5个字']
        ];
        
        const error = validations.find(([cond]) => cond);
        if (error) {
            wx.showToast({ title: error[1], icon: 'none' });
            return;
        }

        // 构建请求数据
        const requestData = {
            feedback_type: selectedFeedbackType,
            intersection_id: parseInt(selectedIntersection),
            ...(selectedFeedbackType === '过路口' && { 
                light_id: parseInt(selectedLight)  // 确保转换为数字
            }),
            ...(selectedFeedbackType === '事故发生' && { 
                description: feedbackText.trim()
            })
        };

        wx.showLoading({ title: '提交中...' });

        wx.request({
            url: 'http://localhost:5000/user_feedback',
            method: 'POST',
            header: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${wx.getStorageSync('token') || ''}`
            },
            data: JSON.stringify(requestData),
            success: (res) => {
                if (res.statusCode === 200) {
                    wx.showToast({ title: '提交成功' });
                    this.resetFeedback();
                } else {
                    let message = '提交失败';
                    if (res.data.code === 'LIGHT_ADJUST_FAILED') {
                        message = '系统繁忙，请稍后再试';
                    }
                    wx.showToast({ title: message, icon: 'none' });
                }
            },
            fail: (err) => {
                console.error('网络请求失败:', err);
                wx.showToast({ title: '网络连接异常', icon: 'none' });
            },
            complete: () => {
                wx.hideLoading();
            }
        });
    },

    resetFeedback() {
        this.setData({
            selectedFeedbackType: null,
            selectedIntersection: null,
            feedbackText: '',
            selectedLight: null
        });
    }
});