// pages/records/records.js
const app = getApp();

Page({
  data: {
    records: [],
  },

  onLoad() {
    this._recordHandler = (record) => {
      if (!record) return;
      const updated = this.data.records.concat(record);
      const MAX = 360;
      if (updated.length > MAX) {
        updated.splice(0, updated.length - MAX);
      }
      this.setData({ records: updated });
    };

    app.bleRecordHandler = this._recordHandler;
  },

  onUnload() {
    if (app.bleRecordHandler === this._recordHandler) {
      app.bleRecordHandler = null;
    }
  },

  clearRecords() {
    this.setData({ records: [] });
  },
});
