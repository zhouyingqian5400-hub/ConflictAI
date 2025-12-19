// app.js - 正确的初始化代码
App({
  onLaunch() {
    // 1. 先检查是否支持云开发
    console.log('检查云开发支持:', typeof wx.cloud);
    
    if (!wx.cloud) {
      console.error('请使用基础库 2.2.3 或以上版本');
      wx.showModal({
        title: '提示',
        content: '当前微信版本过低，无法使用云开发功能',
        showCancel: false
      });
      return;
    }
    
    // 2. 初始化云开发
    // 重要：从你的 cloud:// 路径提取环境ID
    // cloud://zyqconflict-8gmkka6ge2b61709.7a79-zyqconflict-8gmkka6ge2b61709-1391500022
    //        ↑ 环境ID在这里 ↑
    wx.cloud.init({
      env: 'zyqconflict-8gmkka6ge2b61709',  // ⚠️ 必须正确
      traceUser: true,  // 可选：记录用户
    });
    
    // 3. 验证初始化是否成功
    console.log('云开发初始化完成');
    console.log('wx.cloud 对象:', wx.cloud);
    
    // 延迟一点再检查，确保初始化完成
    setTimeout(() => {
      if (typeof wx.cloud.getEnv === 'function') {
        console.log('✅ getEnv 方法存在，环境:', wx.cloud.getEnv());
      } else {
        console.error('❌ getEnv 方法不存在，初始化可能失败');
        console.log('wx.cloud 的属性:', Object.keys(wx.cloud));
      }
    }, 1000);
  },
  
  onShow() {
    console.log('App onShow');
  }
});