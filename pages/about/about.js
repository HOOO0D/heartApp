// pages/records/records.js
const app = getApp();

Page({
  data: {
    // 用来在 WXML 里渲染列表
    records: [],
  },

  // 不在 onLoad 里挂 handler，因为 tabBar 页面切换不会触发 onUnload
  onLoad() {
    // 这里可以什么都不做
  },

  // 1）从 globalData 里把已有历史拉进来
  // 2）注册一个 bleRecordHandler，接收之后的新数据
  onShow() {
    // 1. 先把历史记录读出来
    const buf = (app.globalData && app.globalData.bleValues)
      ? app.globalData.bleValues
      : [];

    const MAX = 360;
    const initRecords =
      buf.length > MAX ? buf.slice(buf.length - MAX) : buf.slice();

    this.setData({
      records: initRecords,
    });

    // 2. 再注册实时 handler，后面每来一条新 record 都追加到列表
    this._recordHandler = (record) => {
      if (!record) return;

      const updated = this.data.records.concat(record);
      if (updated.length > MAX) {
        updated.splice(0, updated.length - MAX);
      }

      this.setData({ records: updated });
    };

    app.bleRecordHandler = this._recordHandler;
  },

  // 页面隐藏（切到别的 tab）时就取消订阅，避免后台还一直 setData
  onHide() {
    if (app.bleRecordHandler === this._recordHandler) {
      app.bleRecordHandler = null;
    }
  },

  // 万一这个页面被销毁，也顺手清掉
  onUnload() {
    if (app.bleRecordHandler === this._recordHandler) {
      app.bleRecordHandler = null;
    }
  },

  // 清空按钮
  clearRecords() {
    this.setData({ records: [] });

    if (app.globalData) {
      app.globalData.bleValues = [];
    }
  },
});
