const app = getApp();

// 将 ArrayBuffer 转为 hex 字符串
function ab2hex(buffer) {
  return Array.prototype.map.call(
    new Uint8Array(buffer),
    bit => ('00' + bit.toString(16)).slice(-2)
  ).join('');
}

// 将 hex 字符串转为 4 个值（val1 ~ val4）
function parseHexToVals(hexStr) {
  const result = [];

  for (let i = 0; i + 4 <= hexStr.length; i += 4) {
    const chunk = hexStr.slice(i, i + 4);
    const reordered = chunk.slice(2, 4) + chunk.slice(0, 2); // 低高位换顺序
    const val = parseInt(reordered, 16);
    result.push(val);
  }

  return result.length === 4 ? result : null; // 保证是 4 个值
}

Page({
  data: {
    records: []
  },

  onLoad() {
    wx.onBLECharacteristicValueChange((res) => {
      const hexVal = ab2hex(res.value);
      const vals = parseHexToVals(hexVal); // [val1, val2, val3, val4]
      if (!vals) return;

      const now = new Date();
      const timestamp = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}.${now.getMilliseconds()}`;

      const record = {
        time: timestamp,
        val1: vals[0],
        val2: vals[1],
        val3: vals[2],
        val4: vals[3]
      };

      const updated = [...this.data.records, record];
      if (updated.length > 360) updated.splice(0, updated.length - 360);

      this.setData({ records: updated });

      // 可选：同步发送到 index 页用于绘图
      if (app.bleChartUpdateHandler) {
        app.bleChartUpdateHandler({
          val1: vals[0],
          val2: vals[1],
          val3: vals[2],
          val4: vals[3]
        });
      }
    });
  },
  clearRecords() {
    this.setData({ records: [] });
  }
  
});
