// pages/peakflow/peakflow.js
const CHART_COLORS = {
    current: '#ff4d4f',
    history: '#1890ff',
    grid: '#dddee0'
  }
  
  Page({
    data: {
      selectedNode: null,
      chartData: [],
      canvasWidth: 300,
      canvasHeight: 200,
      updateTime: '--:--:--'
    },
  
    onLoad(options) {
      const systemInfo = wx.getSystemInfoSync()
      this.setData({
        selectedNode: options.nodeId,
        canvasWidth: systemInfo.windowWidth * 0.9,
        canvasHeight: systemInfo.windowWidth * 0.6
      })
      this.initChart()
      this.startAutoRefresh()
    },
  
    initChart() {
      this.ctx = wx.createCanvasContext('realtimeChart')
      this.drawGrid()
    },
  
    drawGrid() {
      const { canvasWidth, canvasHeight } = this.data
      const ctx = this.ctx
      
      // 绘制背景网格
      ctx.setStrokeStyle(CHART_COLORS.grid)
      ctx.setLineWidth(1)
      
      // 垂直网格线
      for (let i = 0; i < 24; i++) {
        const x = 30 + (canvasWidth - 60) * (i / 23)
        ctx.moveTo(x, 20)
        ctx.lineTo(x, canvasHeight - 30)
      }
      
      // 水平网格线
      for (let i = 0; i <= 5; i++) {
        const y = 20 + (canvasHeight - 50) * (i / 5)
        ctx.moveTo(30, y)
        ctx.lineTo(canvasWidth - 30, y)
      }
      
      ctx.stroke()
      ctx.draw(true)
    },
  
    async fetchData() {
      return new Promise((resolve, reject) => {
        wx.request({
          url: 'http://localhost:5000/api/realtime_flow',
          data: { node_id: this.data.selectedNode },
          success: res => {
            if (res.data.code === 200) {
              this.setData({
                chartData: res.data.data,
                updateTime: res.data.updateTime
              })
              resolve()
            }
          },
          fail: reject
        })
      })
    },
  
    async drawChart() {
      await this.fetchData()
      
      const { chartData, canvasWidth, canvasHeight } = this.data
      const ctx = this.ctx
      
      ctx.clearRect(0, 0, canvasWidth, canvasHeight)
      this.drawGrid()
  
      // 计算最大流量值
      const maxCount = Math.max(...chartData.map(d => d.count), 1)
  
      // 绘制折线
      ctx.beginPath()
      chartData.forEach((point, index) => {
        const x = 30 + (canvasWidth - 60) * (index / 23)
        const y = canvasHeight - 30 - 
                 (point.count / maxCount) * (canvasHeight - 50)
        
        ctx.setStrokeStyle(point.isCurrent ? CHART_COLORS.current : CHART_COLORS.history)
        ctx.setLineWidth(2)
        
        if (index === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
        
        // 绘制数据点
        ctx.beginPath()
        ctx.arc(x, y, 3, 0, 2 * Math.PI)
        ctx.setFillStyle(point.isCurrent ? CHART_COLORS.current : CHART_COLORS.history)
        ctx.fill()
      })
      
      ctx.stroke()
      ctx.draw(true)
    },
  
    startAutoRefresh() {
      this.drawChart()
      this.timer = setInterval(() => {
        this.drawChart()
      }, 30000) // 每30秒刷新
    },
  
    onUnload() {
      clearInterval(this.timer)
    },
  
    touchHandler(e) {
      // 实现触摸交互逻辑
    }
  })