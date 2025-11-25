// pages/records/records.js
const app = getApp();

Page({
  data: {
    records: [],
  },

  onLoad() {
    // 把 handler 存下来，方便 onUnload 时对比解绑（不是必须，但比较规范）
    this._bleRecordHandler = (record) => {
      this.handleNewRecord(record);
    };

    app.bleRecordHandler = this._bleRecordHandler;
  },

  onUnload() {
    if (app.bleRecordHandler === this._bleRecordHandler) {
      app.bleRecordHandler = null;
    }
  },

  handleNewRecord(record) {
    if (!record) return;

    const updated = this.data.records.concat(record);
    const MAX_RECORDS = 360;

    if (updated.length > MAX_RECORDS) {
      updated.splice(0, updated.length - MAX_RECORDS);
    }

    this.setData({ records: updated });
  },

  clearRecords() {
    this.setData({ records: [] });
  },
});
