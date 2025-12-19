// index.js - 首页
const { generateRoomCode, generateUserId } = require('../../utils/cloudDB');
const { checkRoom, joinChatRoom } = require('../../utils/api'); // 改为 joinChatRoom

Page({
  data: {
    // 聊天室代码
    roomCode: '',
    // 是否为默认生成的代码
    isDefaultCode: true,
    // 选中的AI模型类型
    selectedModel: 'narrative', // 'narrative' 或 'argumentative'
    // 用户身份：'parent' 或 'child'
    userRole: '', // 'parent' 或 'child'
    // 按钮加载状态
    loading: false
  },

  onLoad() {
    // 页面加载时生成默认聊天室代码
    this.generateDefaultCode();
  },

  /**
   * 生成默认聊天室代码
   */
  generateDefaultCode() {
    const code = generateRoomCode();
    this.setData({
      roomCode: code,
      isDefaultCode: true
    });
  },

  /**
   * 刷新聊天室代码
   */
  refreshCode() {
    this.generateDefaultCode();
  },

  /**
   * 输入聊天室代码
   */
  onCodeInput(e) {
    const value = e.detail.value;
    this.setData({
      roomCode: value.trim(),
      isDefaultCode: false // 用户手动输入，标记为非默认代码
    });
  },

  /**
   * 选择AI模型
   */
  selectModel(e) {
    const modelType = e.currentTarget.dataset.model;
    this.setData({
      selectedModel: modelType
    });
  },

  /**
   * 选择用户身份
   */
  selectUserRole(e) {
    const role = e.currentTarget.dataset.role; // 'parent' 或 'child'
    this.setData({
      userRole: role
    });
  },

  /**
   * 验证聊天室代码格式
   */
  validateCode(code) {
    const pattern = /^CHAT-\d{3}$/;
    return pattern.test(code);
  },

  /**
   * 进入聊天室
   */
  async enterChatRoom() {
    const { roomCode, selectedModel, loading } = this.data;

    // 防止重复点击
    if (loading) return;

    // 验证代码格式
    if (!this.validateCode(roomCode)) {
      wx.showToast({
        title: '代码格式应为 CHAT-xxx',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 验证模型选择
    if (!selectedModel) {
      wx.showToast({
        title: '请选择AI模型',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 验证身份选择
    const { userRole } = this.data;
    if (!userRole) {
      wx.showToast({
        title: '请选择您的身份（家长/孩子）',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 设置加载状态
    this.setData({ loading: true });

    try {
      const { isDefaultCode } = this.data;
      
      // 如果不是默认代码，先检查聊天室是否存在
      if (!isDefaultCode) {
        const status = await checkRoom(roomCode); // 使用 checkRoom
        if (!status.exists) {
          wx.showModal({
            title: '提示',
            content: '代码无效',
            showCancel: false
          });
          this.setData({ loading: false });
          return;
        }
        if (status.occupancy >= status.maxCapacity) {
          wx.showModal({
            title: '提示',
            content: '聊天室已满',
            showCancel: false
          });
          this.setData({ loading: false });
          return;
        }
      }

      // 生成用户ID
      const userId = generateUserId();
      
      // 加入聊天室（默认代码会自动创建新房间），传入用户身份
      const result = await joinChatRoom(roomCode, userId, selectedModel, userRole);

      if (result.success) {
        // 保存用户信息到本地存储
        wx.setStorageSync('userId', userId);
        wx.setStorageSync('roomCode', roomCode);
        wx.setStorageSync('modelType', selectedModel);
        wx.setStorageSync('userRole', userRole);

        // 跳转到聊天室页面
        wx.navigateTo({
          url: `/pages/chat/chat?roomCode=${roomCode}&modelType=${selectedModel}`
        });
      } else {
        wx.showModal({
          title: '提示',
          content: result.error || '进入聊天室失败',
          showCancel: false
        });
      }
    } catch (error) {
      console.error('进入聊天室失败:', error);
      wx.showToast({
        title: '网络错误，请重试',
        icon: 'none',
        duration: 2000
      });
    } finally {
      this.setData({ loading: false });
    }
  }
});
