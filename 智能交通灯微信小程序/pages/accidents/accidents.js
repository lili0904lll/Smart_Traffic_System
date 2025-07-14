// pages/accidents/accidents.js
Page({
    data: {
        accidents: []
    },
    onLoad(options) {
        const intersectionId = options.intersectionId;
        this.getAccidentRecords(intersectionId);
    },
    getAccidentRecords(intersectionId) {
        wx.request({
            url: 'http://localhost:5000/get_accident_records',
            data: { intersection_id: intersectionId },
            success: (res) => {
                this.setData({ accidents: res.data });
            }
        });
    }
});

