// chat.js - 聊天室页面
const { fetchMessages, fetchVisibleMessages, sendMessageToAI, checkRoom } = require('../../utils/api');
const { generateUserId, ROOM_STATUS, sendSystemStartMessage: createSystemStartMessage } = require('../../utils/cloudDB');
const { PROMPTS } = require('../../utils/prompts');

Page({
  data: {
    roomCode: '',
    modelType: 'narrative',
    modelName: '叙事型说服者',
    userId: '',
    messages: [],
    inputText: '',
    loading: false,
    aiThinking: false,
    showPromptModal: false,
    promptText: '',
    scrollIntoView: '',
    // 聊天室状态
    roomStatus: ROOM_STATUS.WAITING,
    canSendMessage: false,
    waitingText: '等待其他用户加入...',
    // 轮询定时器
    statusCheckTimer: null,
    // 系统消息发送标志（防止重复发送）
    systemMessageSent: false,
    // 系统消息发送中标志（防止并发发送）
    sendingSystemMessage: false
  },

  onLoad(options) {
    const { roomCode, modelType } = options;
    
    // 获取用户ID（从本地存储或生成新的）
    let userId = wx.getStorageSync('userId');
    if (!userId) {
      userId = generateUserId();
      wx.setStorageSync('userId', userId);
    }

    const modelNames = {
      narrative: '叙事型说服者',
      argumentative: '论证型说服者'
    };

    const currentModelType = modelType || 'narrative';
    const promptText = (PROMPTS[currentModelType] && PROMPTS[currentModelType].systemPrompt) || '';

    this.setData({
      roomCode: roomCode || '',
      modelType: currentModelType,
      modelName: modelNames[currentModelType] || '叙事型说服者',
      userId: userId,
      promptText: promptText
    });

    // 初始化聊天室状态检测
    this.initRoomStatus();
  },

  /**
   * 页面显示时触发（从其他页面返回时）
   */
  onShow() {
    // 页面显示时立即检测一次状态（用户可能从其他页面返回）
    if (this.data.roomCode) {
      this.checkRoomStatus();
    }
  },

  onUnload() {
    // 清除定时器
    if (this.data.statusCheckTimer) {
      clearInterval(this.data.statusCheckTimer);
    }
  },

  /**
   * 初始化聊天室状态检测
   */
  async initRoomStatus() {
    // 首次加载消息
    await this.loadMessages();
    
    // 检查是否已存在系统启动消息（防止重复发送）
    await this.checkSystemMessageExists();
    
    // 首次检查状态
    await this.checkRoomStatus();
    
    // 开始轮询检测聊天室状态（每300ms检测一次，提高响应速度）
    const timer = setInterval(() => {
      this.checkRoomStatus();
    }, 300); // 从1000ms改为300ms
    
    this.setData({
      statusCheckTimer: timer
    });
  },

  /**
   * 页面显示时触发（从其他页面返回时）
   */
  onShow() {
    // 页面显示时立即检测一次状态（用户可能从其他页面返回）
    if (this.data.roomCode) {
      this.checkRoomStatus();
    }
  },

  /**
   * 检查聊天室状态
   */
  async checkRoomStatus() {
    try {
      const { roomCode, roomStatus: currentStatus, canSendMessage: currentCanSend, waitingText: currentWaitingText } = this.data;
      const status = await checkRoom(roomCode);
      
      console.log('[状态检测] 聊天室代码:', roomCode, '当前状态:', currentStatus, '检测到状态:', status.status, '用户数量:', status.occupancy);
      
      if (!status.exists) {
        wx.showToast({
          title: '聊天室不存在',
          icon: 'none'
        });
        setTimeout(() => {
          this.goBack();
        }, 1500);
        return;
      }

      const newStatus = status.status || ROOM_STATUS.WAITING;
      let canSendMessage = false;
      let waitingText = '等待其他用户加入...';

      // 检测状态变化和人数变化
      const statusChanged = currentStatus !== newStatus;
      const wasWaiting = currentStatus === ROOM_STATUS.WAITING || currentStatus === 'WAITING';
      const nowReady = newStatus === ROOM_STATUS.READY || newStatus === 'READY';
      const occupancyReached = status.occupancy >= 2;

      console.log('[状态检测] 状态变化:', statusChanged, '从WAITING变为READY:', wasWaiting && nowReady, '人数达标:', occupancyReached);

      if (status.occupancy < 2) {
        // 等待阶段
        canSendMessage = false;
        waitingText = `等待其他用户加入... (${status.occupancy}/2)`;
      } else if (status.occupancy >= 2) {
        // 满2人，可以开始对话
        canSendMessage = true;
        waitingText = '';
        
        // 检查是否需要发送系统启动消息
        // 只在状态从 WAITING 变为 READY 时触发一次，避免重复触发
        // 添加更严格的检查：确保只在真正从WAITING变为READY时触发，且只触发一次
        if (!this.data.systemMessageSent && 
            statusChanged && 
            wasWaiting && 
            nowReady && 
            occupancyReached &&
            !this.data.sendingSystemMessage) { // 添加发送中标志，防止并发
          console.log('[状态检测] 触发条件满足，准备发送系统启动消息');
          // 立即设置发送中标志，防止重复触发
          this.setData({
            sendingSystemMessage: true
          });
          
          const result = await this.sendSystemStartMessage();
          
          // 无论成功与否，都设置标志，避免重复触发
          // result.success 表示是否成功发送，result.reason 表示原因
          if (result && (result.success || result.reason === 'already_exists' || result.reason === 'already_sent' || result.reason === 'already_sent_by_other')) {
            this.setData({
              systemMessageSent: true,
              sendingSystemMessage: false
            });
          } else {
            // 如果发送失败，重置发送中标志，允许重试
            this.setData({
              sendingSystemMessage: false
            });
          }
        }
        
        // 如果状态是READY，确保系统消息可见（防止某些用户看不到）
        if (newStatus === ROOM_STATUS.READY && canSendMessage) {
          await this.ensureSystemMessageVisible();
        }
      }

      // 只在状态真正变化时才更新，避免频繁的 setData 导致 iOS 输入框内容丢失
      const needUpdate = 
        currentStatus !== newStatus || 
        currentCanSend !== canSendMessage || 
        currentWaitingText !== waitingText;
      
      if (needUpdate) {
        this.setData({
          roomStatus: newStatus,
          canSendMessage: canSendMessage,
          waitingText: waitingText
        });
      }
    } catch (error) {
      console.error('检查聊天室状态失败:', error);
    }
  },

  /**
   * 发送系统启动消息
   */
  async sendSystemStartMessage() {
    try {
      const { roomCode } = this.data;
      const result = await createSystemStartMessage(roomCode);
      
      if (result && result.success) {
        console.log('[系统消息] 发送成功:', result.message);
        // 重新加载消息（包含系统启动消息）
        await this.loadMessages();
        return result;
      } else {
        console.log('[系统消息] 未发送，原因:', result ? result.reason : 'unknown');
        return result;
      }
    } catch (error) {
      console.error('发送系统启动消息失败:', error);
      return { success: false, reason: 'error', error: error.message };
    }
  },

  /**
   * 检查是否已存在系统启动消息
   */
  async checkSystemMessageExists() {
    try {
      const { roomCode } = this.data;
      const SYSTEM_START_MESSAGE = '听说你最近和家人因为手机使用的问题产生了矛盾，请问能跟我讲讲你对这个矛盾的想法吗？最近一次矛盾是什么样的？你是怎么想的？请尽可能详尽的告诉我，让我更好地了解情况。';
      
      const { getVisibleMessages } = require('../../utils/api');
      const messages = await getVisibleMessages(roomCode, this.data.userId);
      
      // 检查是否存在系统启动消息
      const hasSystemMessage = messages.some(msg => 
        msg.role === 'system' && msg.content === SYSTEM_START_MESSAGE
      );
      
      if (hasSystemMessage) {
        console.log('[系统消息] 检测到已存在系统启动消息，设置标志');
        this.setData({
          systemMessageSent: true
        });
      }
    } catch (error) {
      console.error('检查系统消息失败:', error);
    }
  },

  /**
   * 确保系统消息对所有用户可见
   */
  async ensureSystemMessageVisible() {
    try {
      const { roomCode, userId } = this.data;
      const SYSTEM_START_MESSAGE = '听说你最近和家人因为手机使用的问题产生了矛盾，请问能跟我讲讲你对这个矛盾的想法吗？最近一次矛盾是什么样的？你是怎么想的？请尽可能详尽的告诉我，让我更好地了解情况。';
      
      // 检查数据库中是否存在系统消息
      const db = wx.cloud.database();
      const systemMessages = await db.collection('messages').where({
        roomCode: roomCode,
        role: 'system',
        content: SYSTEM_START_MESSAGE
      }).get();
      
      if (systemMessages.data.length > 0) {
        // 系统消息存在，检查当前用户是否能看到
        const { getVisibleMessages } = require('../../utils/api');
        const visibleMessages = await getVisibleMessages(roomCode, userId);
        
        const hasSystemMessage = visibleMessages.some(msg => 
          msg.role === 'system' && msg.content === SYSTEM_START_MESSAGE
        );
        
        if (!hasSystemMessage) {
          console.log('[系统消息] 系统消息存在但当前用户看不到，重新加载消息');
          // 重新加载消息
          await this.loadMessages();
        }
      }
    } catch (error) {
      console.error('确保系统消息可见失败:', error);
    }
  },

  
  /**
   * 加载历史消息（只显示当前用户可见的消息）
   */
  async loadMessages() {
    try {
      const { roomCode, userId } = this.data;
      const messages = await fetchVisibleMessages(roomCode, userId);
      
      // 格式化消息，确保时间戳是数字
      const formattedMessages = messages.map(msg => {
        const timestamp = typeof msg.timestamp === 'number' 
          ? msg.timestamp 
          : (msg.timestamp && msg.timestamp.seconds 
            ? msg.timestamp.seconds * 1000 
            : Date.now());
        
        return {
          id: msg.id || `msg_${timestamp}`,
          role: msg.role,
          content: msg.content || '',
          timestamp: timestamp,
          timeText: this.formatTime(timestamp)
        };
      });

      this.setData({
        messages: formattedMessages
      });

      // 滚动到底部
      this.scrollToBottom();
    } catch (error) {
      console.error('加载消息失败:', error);
    }
  },


  /**
   * 输入文本
   */
  onInput(e) {
    const value = e.detail.value;
    this.setData({
      inputText: value
    });
    
    // 如果输入框内容变化，确保能够自适应高度
    // auto-height 会自动处理，这里可以添加额外逻辑
  },

  /**
   * 发送消息
   */
  async sendMessage() {
    const { inputText, loading, aiThinking, roomCode, userId, modelType, canSendMessage } = this.data;

    // 检查是否可以发送消息
    if (!canSendMessage) {
      wx.showToast({
        title: '等待其他用户加入...',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 防止重复发送
    if (loading || aiThinking || !inputText.trim()) {
      return;
    }

    const userMessage = inputText.trim();
    
    // 检查字数限制（250字）
    if (userMessage.length > 220) {
      wx.showToast({
        title: '字数限制220字，可以分两次发送',
        icon: 'none',
        duration: 3000
      });
      return;
    }
    
    // 清空输入框
    this.setData({
      inputText: '',
      loading: true,
      aiThinking: true
    });

    // 添加用户消息到界面
    const userMsg = {
      id: 'user_' + Date.now(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      timeText: this.formatTime(Date.now())
    };

    this.setData({
      messages: [...this.data.messages, userMsg],
      roomStatus: ROOM_STATUS.ACTIVE // 更新状态为进行中
    });

    // 滚动到底部
    this.scrollToBottom();

    try {
      // 发送消息到AI
      const aiMessage = await sendMessageToAI(roomCode, userId, userMessage, modelType);
      
      console.log('[发送消息] AI消息返回:', aiMessage);
      
      // 立即将AI消息添加到界面（不等待数据库同步）
      const aiMsg = {
        id: aiMessage.id || `ai_${Date.now()}`,
        role: 'ai',
        content: aiMessage.content,
        timestamp: aiMessage.timestamp || Date.now(),
        timeText: this.formatTime(aiMessage.timestamp || Date.now())
      };
      
      this.setData({
        messages: [...this.data.messages, aiMsg],
        aiThinking: false,
        loading: false
      });
      
      // 滚动到底部
      this.scrollToBottom();
      
      // 后台重新加载消息（确保数据同步）
      setTimeout(async () => {
        await this.loadMessages();
      }, 1000);
      
    } catch (error) {
      console.error('发送消息失败:', error);
      
      // 显示错误消息
      const now = Date.now();
      this.setData({
        messages: [...this.data.messages, {
          id: 'error_' + now,
          role: 'ai',
          content: error.message || '抱歉，AI暂时无法回复，请稍后重试。',
          timestamp: now,
          timeText: this.formatTime(now),
          isError: true
        }],
        aiThinking: false,
        loading: false
      });

      wx.showToast({
        title: error.message || '发送失败，请重试',
        icon: 'none',
        duration: 2000
      });
    }
  },

  /**
   * 键盘发送（Enter键或换行键）
   * 当用户按回车键时，如果内容不为空，就发送消息
   */
  onConfirm(e) {
    // 换行键或发送键都触发发送
    const { inputText } = this.data;
    
    // 如果输入框有内容，就发送（去掉末尾的换行符）
    if (inputText && inputText.trim()) {
      // 去掉末尾的换行符，保留内容中的换行
      const trimmedText = inputText.replace(/\n+$/, '');
      if (trimmedText.trim()) {
        this.setData({
          inputText: trimmedText
        });
        // 直接发送，不需要延迟
        this.sendMessage();
      }
    }
  },

  /**
   * 行高变化时触发（用于调整输入框高度）
   */
  onLineChange(e) {
    // 当行数变化时，确保输入框能够自适应高度
    // auto-height 已经启用，这里可以添加额外的处理逻辑
    const lineCount = e.detail.lineCount || 1;
    console.log('[输入框] 行数变化:', lineCount);
  },

  /**
   * 滚动到底部
   */
  scrollToBottom() {
    const messages = this.data.messages;
    if (messages.length > 0) {
      const lastIndex = messages.length - 1;
      this.setData({
        scrollIntoView: `msg-${lastIndex}`
      });
    }
  },

  /**
   * 返回首页
   */
  goBack() {
    wx.navigateBack({
      delta: 1
    });
  },

  /**
   * 显示/隐藏Prompt弹窗
   */
  togglePromptModal() {
    const { modelType } = this.data;
    const promptText = (PROMPTS[modelType] && PROMPTS[modelType].systemPrompt) || '';
    this.setData({
      showPromptModal: !this.data.showPromptModal,
      promptText: promptText
    });
  },

  /**
   * 关闭Prompt弹窗
   */
  closePromptModal() {
    this.setData({
      showPromptModal: false
    });
  },

  /**
   * 复制消息
   */
  copyMessage(e) {
    const content = e.currentTarget.dataset.content;
    wx.setClipboardData({
      data: content,
      success: () => {
        wx.showToast({
          title: '已复制',
          icon: 'success',
          duration: 1500
        });
      }
    });
  },

  /**
   * 阻止事件冒泡
   */
  stopPropagation() {
    // 阻止事件冒泡
  },

  /**
   * 格式化时间
   */
  formatTime(timestamp) {
    // 确保时间戳是数字
    const ts = typeof timestamp === 'number' 
      ? timestamp 
      : (timestamp && timestamp.seconds 
        ? timestamp.seconds * 1000 
        : Date.now());
    
    const date = new Date(ts);
    
    // 检查日期是否有效
    if (isNaN(date.getTime())) {
      return '--:--';
    }
    
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }
});
