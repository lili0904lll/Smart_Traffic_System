const CHART_COLOR = '#1989fa';
const GRID_COLOR = '#eee';

Page({
    data: {
        intersections: Array.from({ length: 15 }, (_, i) => ({ id: i + 1 })),
        selectedIntersection: null,
        selectedQueryType: null,
        accidentRecords: [],
        avgFlow: "",
        peakFlows: [],
        chart: null,
        canvasWidth: 300,
        canvasHeight: 200,
        dateOptions: [],
        selectedDate: '',
        averageData: null,
        updateTime: '',
        exportStartDate: '',
        exportEndDate: ''
    },

    onLoad() {
        this.setData({
            selectedIntersection: null,
            selectedQueryType: null
        });
    },

    selectIntersection(e) {
        const id = e.currentTarget.dataset.id;
        this.setData({ selectedIntersection: id });
    },

    selectQueryType(e) {
        const type = e.currentTarget.dataset.type;
        this.setData({ selectedQueryType: type });
        if (type === 'accident') {
            this.getAccidentRecords();
        } else if (type === 'avgFlow') {
            this.getAvgFlow();
        } else if (type === 'peakFlow') {
            this.getPeakFlows();
        }
    },

    getAccidentRecords() {
        const intersectionId = this.data.selectedIntersection;
        const token = wx.getStorageSync('token');
        wx.showLoading({ title: '加载中...' });
        wx.request({
            url: 'http://localhost:5000/get_accident_records',
            data: { intersection_id: intersectionId },
            header: {
                'Authorization': 'Bearer ' + token
            },
            success: (res) => {
                if (res.data.error) {
                    wx.showToast({ title: res.data.error, icon: 'none' });
                    return;
                }
                this.setData({ 
                    accidentRecords: res.data.map(item => ({
                        ...item,
                        date: item.date.replace('T', ' ').split('.')[0]
                    })) 
                });
            },
            fail: (err) => {
                console.error('请求失败:', err);
                wx.showToast({ title: '加载失败', icon: 'none' });
            },
            complete: wx.hideLoading
        });
    },

    getAvgFlow() {
        const intersectionId = this.data.selectedIntersection;
        const token = wx.getStorageSync('token');
        wx.showLoading({ title: '计算中...' });
        wx.request({
            url: 'http://localhost:5000/get_average_flow',
            data: { intersection_id: intersectionId },
            header: {
                'Authorization': 'Bearer ' + token
            },
            success: (res) => {
                if (res.data.error) {
                    wx.showToast({ title: res.data.error, icon: 'none' });
                    return;
                }
                wx.navigateTo({
                    url: `/pages/averageflow/averageflow?data=${JSON.stringify(res.data)}`
                });
            },
            fail: (err) => {
                console.error('请求失败:', err);
                wx.showToast({ title: '获取失败', icon: 'none' });
            },
            complete: wx.hideLoading
        });
    },

    getPeakFlows() {
        const intersectionId = this.data.selectedIntersection;
        const selectedDate = this.data.selectedDate; // 新增
        if (!this.validateIntersection(intersectionId)) return;
        const token = wx.getStorageSync('token');
        wx.showLoading({ title: '加载中...' });
        wx.request({
            url: 'http://localhost:5000/get_traffic_flow',
            data: { intersection_id: intersectionId, date: selectedDate }, // 传递日期
            header: {
                'Authorization': 'Bearer ' + token
            },
            success: (res) => {
                if (res.data.error) {
                    wx.showToast({ title: res.data.error, icon: 'none' });
                    return;
                }
                this.processPeakData(res.data);
            },
            fail: (err) => {
                console.error('请求失败:', err);
                wx.showToast({ title: '加载失败', icon: 'none' });
            },
            complete: wx.hideLoading
        });
    },
    validateIntersection(id) {
        if (!id || id < 1 || id > 15) {
            wx.showToast({ title: '请先选择有效路口', icon: 'none' });
            return false;
        }
        return true;
    },

    processPeakData(data) {
        const formattedData = data.map(item => ({
            time_period: item.time_period,
            flow_count: item.flow_count,
            date: item.record_date
        }));
        
        this.setData({ 
            peakFlows: formattedData,
            updateTime: new Date().toLocaleTimeString()
        });
        
        if (this.data.selectedQueryType === 'peakFlow') {
            this.drawChart(formattedData);
        }
    },

    onReady() {
        this.initChart();
        this.loadDateOptions();
    },
    
    initChart() {
        this.chart = this.selectComponent('#chart');
        const systemInfo = wx.getSystemInfoSync();
        this.setData({
          canvasWidth: systemInfo.windowWidth * 0.9,
          canvasHeight: systemInfo.windowWidth * 0.6
        });
    },
    
    loadDateOptions() {
        const token = wx.getStorageSync('token');
        wx.request({
          url: 'http://localhost:5000/flow_dates',
          header: {
            'Authorization': 'Bearer ' + token
          },
          success: res => {
            this.setData({
              dateOptions: res.data,
              selectedDate: res.data[0] || ''
            });
            this.loadChartData();
          }
        });
    },
    
    loadChartData() {
        if (!this.data.selectedIntersection ||
            !this.data.selectedDate) {
                wx.showToast({ title: '请先选择路口和日期', icon: 'none' });
                return;
            }
        const token = wx.getStorageSync('token');
        wx.showLoading({ title: '加载中...' });
        wx.request({
          url: 'http://localhost:5000/get_daily_flow',
          data: {
            intersection_id: this.data.selectedIntersection,
            date: this.data.selectedDate
          },
          header: {
            'Authorization': 'Bearer ' + token
          },
          success: res => {
            if (res.data.error) return;
            this.drawChart(res.data.data);
            this.setData({ updateTime: res.data.update_time });
          },
          complete: wx.hideLoading
        });
    },

    drawChart(data) {
        const ctx = wx.createCanvasContext('peakFlowChart');
        ctx.clearRect(0, 0, this.data.canvasWidth, this.data.canvasHeight);
        
        if (data.length === 0) {
            this.drawNoData(ctx);
            return;
        }
        
        this.drawAxis(ctx, data);
        this.drawLine(ctx, data);
        ctx.draw();
    },

    drawNoData(ctx) {
        ctx.setFontSize(16);
        ctx.setFillStyle('#666');
        ctx.fillText('暂无数据', 
            this.data.canvasWidth/2 - 40, 
            this.data.canvasHeight/2
        );
    },

    drawLine(ctx, data) {
        ctx.beginPath();
        ctx.setStrokeStyle(CHART_COLOR);
        ctx.setLineWidth(2);
        
        const maxCount = Math.max(...data.map(d => d.count), 1);
        const xStep = (this.data.canvasWidth - 60) / (data.length - 1);
        
        data.forEach((item, index) => {
            const x = 30 + index * xStep;
            const y = this.data.canvasHeight - 30 - 
                     (item.count / maxCount) * (this.data.canvasHeight - 60);
            
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.setFillStyle(CHART_COLOR);
            ctx.fill();
        });
        
        ctx.stroke();
    },

    drawAxis(ctx, data) {
        ctx.setStrokeStyle(GRID_COLOR);
        ctx.setLineWidth(1);
        
        // Y轴
        ctx.beginPath();
        ctx.moveTo(30, 20);
        ctx.lineTo(30, this.data.canvasHeight - 30);
        ctx.stroke();
        
        // X轴
        ctx.beginPath();
        ctx.moveTo(20, this.data.canvasHeight - 30);
        ctx.lineTo(this.data.canvasWidth - 20, this.data.canvasHeight - 30);
        ctx.stroke();
        
        // Y轴刻度
        const maxCount = Math.max(...data.map(d => d.count), 1);
        const gridSteps = maxCount > 0 ? Math.ceil(maxCount / 5) : 1;
        for (let i = 0; i <= 5; i++) {
            const y = this.data.canvasHeight - 30 - (i * (this.data.canvasHeight - 60) / 5);
            ctx.setFontSize(10);
            ctx.setFillStyle('#666');
            ctx.fillText(i * gridSteps, 10, y + 4);
            ctx.beginPath();
            ctx.setLineDash([5, 3]);
            ctx.moveTo(30, y);
            ctx.lineTo(this.data.canvasWidth - 30, y);
            ctx.stroke();
        }
        
        // X轴标签
        ctx.setLineDash([]);
        data.forEach((item, index) => {
        const x = 30 + index * ((this.data.canvasWidth - 60) / (data.length - 1));
        ctx.setFontSize(10);
        // 安全处理 time_period
        const timeLabel = item.time_period ? 
            item.time_period.split('-')[0] : 
            `${index * 2}:00`;  // 默认值
        
        ctx.fillText(timeLabel, x - 15, this.data.canvasHeight - 15);
    });
    },

    handleDateChange(e) {
        this.setData({ selectedDate: e.detail.value });
        if (this.data.selectedQueryType === 'peakFlow') {
            this.getPeakFlows();
        } else {
            this.loadChartData();
        }
    },

    // 在 methods 中添加以下方法
    refreshChart() {
        wx.showLoading({ title: '刷新中...' });
        this.loadChartData();
        setTimeout(() => {
            wx.hideLoading();
            wx.showToast({ title: '数据已更新', icon: 'success' });
        }, 1000);
    },
    // 选择导出起始日期
onStartDateChange(e) {
    this.setData({ exportStartDate: e.detail.value });
},
// 选择导出结束日期
onEndDateChange(e) {
    this.setData({ exportEndDate: e.detail.value });
},
// 导出Excel
// 小程序前端修改（history.js）
exportExcel() {
    const { selectedIntersection, exportStartDate, exportEndDate } = this.data;
    if (!selectedIntersection || !exportStartDate || !exportEndDate) {
        wx.showToast({ title: '请选择路口和时间范围', icon: 'none' });
        return;
    }
    
    wx.showLoading({ title: '准备下载...' });
    const token = wx.getStorageSync('token');
    
    wx.downloadFile({
        url: `http://localhost:5000/export_traffic_flow?intersection_id=${selectedIntersection}&start_date=${exportStartDate}&end_date=${exportEndDate}`,
        header: { 'Authorization': 'Bearer ' + token },
        success: (res) => {
            wx.hideLoading();
            if (res.statusCode === 200) {
                // 保存到本地缓存
                const fs = wx.getFileSystemManager();
                const savePath = `${wx.env.USER_DATA_PATH}/${Date.now()}.xlsx`;
                
                fs.saveFile({
                    tempFilePath: res.tempFilePath,
                    filePath: savePath,
                    success: () => {
                        wx.openDocument({
                            filePath: savePath,
                            showMenu: true,
                            success: () => {
                                wx.showToast({ title: '文件已保存，可分享' });
                                // 触发分享功能
                                this.setData({ shareFilePath: savePath });
                            }
                        });
                    }
                });
            } else {
                wx.showToast({ title: '服务器错误：' + res.statusCode, icon: 'none' });
            }
        },
        fail: (err) => {
            wx.hideLoading();
            wx.showToast({ title: '下载失败：' + err.errMsg, icon: 'none' });
        }
    });
},

// 在Page配置中添加分享处理
onShareAppMessage() {
    return {
        title: '交通流量数据',
        path: '/pages/history/history',
        success: () => {
            if (this.data.shareFilePath) {
                wx.shareFileMessage({
                    filePath: this.data.shareFilePath,
                    fileName: '交通流量数据.xlsx'
                });
            }
        }
    };
},
// 导出折线图
exportChart() {
    const { selectedIntersection, exportStartDate, exportEndDate } = this.data;
    if (!selectedIntersection || !exportStartDate || !exportEndDate) {
        wx.showToast({ title: '请选择路口和时间范围', icon: 'none' });
        return;
    }
    const token = wx.getStorageSync('token');
    wx.downloadFile({
        url: `http://localhost:5000/export_traffic_chart?intersection_id=${selectedIntersection}&start_date=${exportStartDate}&end_date=${exportEndDate}`,
        header: { 'Authorization': 'Bearer ' + token },
        success: (res) => {
            if (res.statusCode === 200) {
                wx.previewImage({
                    urls: [res.tempFilePath]
                });
            } else {
                wx.showToast({ title: '导出失败', icon: 'none' });
            }
        }
    });
},

    goBack() {
        this.setData({ 
            selectedIntersection: null,
            selectedQueryType: null,
            accidentRecords: [],
            avgFlow: "",
            peakFlows: []
        });
    },
    

    goBackToQueryType() {
        this.setData({ 
            selectedQueryType: null,
            accidentRecords: [],
            avgFlow: "",
            peakFlows: []
        });
    }
});