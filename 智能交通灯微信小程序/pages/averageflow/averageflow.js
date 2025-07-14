Page({
    data: {
        intersectionId: '',
        date: '',
        average: '-' // 默认显示为'-'
    },

    onLoad(options) {
        if (options.data) {
            const data = JSON.parse(options.data);
            let avg = '-';
            // 判断后端返回的 average_flow 是否有数据
            if (typeof data.average_flow === 'number' && data.average_flow > 0) {
                avg = data.average_flow;
            }
            this.setData({
                intersectionId: data.intersection_id,
                date: data.date,
                average: avg
            });
        }
    },

    navigateBack() {
        wx.navigateBack();
    }
});