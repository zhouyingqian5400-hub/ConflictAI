// 聊天室管理 - 模拟后端逻辑
// 在实际项目中，这些应该通过API调用后端服务

// 存储聊天室数据（内存中，实际应该在后端）
const rooms = new Map();

// 存储用户会话
const sessions = new Map();

// 聊天室状态常量
const ROOM_STATUS = {
  WAITING: 'WAITING',    // 等待中：用户数 < 2
  READY: 'READY',        // 就绪：用户数 = 2，可以开始对话
  ACTIVE: 'ACTIVE',      // 进行中：至少有一方已发送消息
  ENDED: 'ENDED'         // 已结束
};

// 系统启动消息
const SYSTEM_START_MESSAGE = '我已经基本了解情况了，请问能跟我讲讲你对这个矛盾的想法吗？你是怎么想的？';

/**
 * 生成随机聊天室代码
 */
function generateRoomCode() {
  const num = Math.floor(Math.random() * 900) + 100; // 100-999
  return `CHAT-${num}`;
}

/**
 * 获取或创建聊天室
 */
function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      users: [],
      messages: [],
      status: ROOM_STATUS.WAITING,
      startMessageSent: false,
      createdAt: Date.now()
    });
  }
  return rooms.get(code);
}

/**
 * 检查聊天室状态
 */
function checkRoomStatus(code) {
  const room = rooms.get(code);
  if (!room) {
    return { exists: false, occupancy: 0, maxCapacity: 3, status: ROOM_STATUS.WAITING };
  }
  
  // 更新房间状态
  let status = room.status;
  if (room.users.length < 2) {
    status = ROOM_STATUS.WAITING;
  } else if (room.users.length === 2 && !room.startMessageSent) {
    status = ROOM_STATUS.READY;
  } else if (room.messages.some(msg => msg.role === 'user')) {
    status = ROOM_STATUS.ACTIVE;
  }
  
  room.status = status;
  
  return {
    exists: true,
    occupancy: room.users.length,
    maxCapacity: 3,
    status: status
  };
}

/**
 * 加入聊天室
 */
function joinRoom(code, userId, modelType) {
  // 先检查代码格式（应该在调用前检查，但这里做双重保险）
  const codePattern = /^CHAT-\d{3}$/;
  if (!codePattern.test(code)) {
    return { success: false, error: '代码无效' };
  }
  
  const room = getOrCreateRoom(code);
  const status = checkRoomStatus(code);
  
  // 检查人数限制
  if (status.occupancy >= status.maxCapacity) {
    return { success: false, error: '聊天室已满' };
  }
  
  // 检查用户是否已在房间中
  if (!room.users.find(u => u.userId === userId)) {
    room.users.push({
      userId,
      modelType,
      joinedAt: Date.now()
    });
  }
  
  // 创建或更新会话
  sessions.set(userId, {
    userId,
    roomCode: code,
    modelType,
    messages: []
  });
  
  return { success: true, room };
}

/**
 * 获取用户会话
 */
function getUserSession(userId) {
  return sessions.get(userId);
}

/**
 * 保存消息
 * @param {string} roomCode - 聊天室代码
 * @param {string} userId - 用户ID（发送者）
 * @param {string} message - 消息内容
 * @param {string} role - 消息角色：'user', 'ai', 'system'
 * @param {string} targetUserId - 目标用户ID（AI回复的目标用户，可选）
 */
function saveMessage(roomCode, userId, message, role = 'user', targetUserId = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  const msg = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId, // 发送者ID
    role, // 'user' 或 'ai' 或 'system'
    content: message,
    timestamp: Date.now(),
    targetUserId: targetUserId || userId // AI回复的目标用户，默认为发送者
  };
  
  room.messages.push(msg);
  
  // 同时保存到用户会话（只保存当前用户相关的消息）
  const session = sessions.get(userId);
  if (session) {
    session.messages.push(msg);
  }
  
  // 如果消息是发给其他用户的，也要保存到目标用户的会话
  if (targetUserId && targetUserId !== userId) {
    const targetSession = sessions.get(targetUserId);
    if (targetSession) {
      targetSession.messages.push(msg);
    }
  }
  
  return msg;
}

/**
 * 获取聊天室消息（全部消息，用于AI学习）
 */
function getRoomMessages(roomCode, cursor = 0) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  
  return room.messages.slice(cursor);
}

/**
 * 获取当前用户可见的消息（消息过滤）
 * @param {string} roomCode - 聊天室代码
 * @param {string} currentUserId - 当前用户ID
 * @returns {Array} 过滤后的消息列表
 */
function getVisibleMessages(roomCode, currentUserId) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  
  return room.messages.filter(msg => {
    // 系统消息：所有人可见
    if (msg.role === 'system') {
      return true;
    }
    
    // 用户消息：只显示自己的
    if (msg.role === 'user') {
      return msg.userId === currentUserId;
    }
    
    // AI消息：只显示发给自己的
    if (msg.role === 'ai') {
      return msg.targetUserId === currentUserId;
    }
    
    return false;
  });
}

/**
 * 获取对方用户的消息（用于AI学习）
 */
function getOtherUserMessages(roomCode, currentUserId) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  
  // 找到其他用户
  const otherUsers = room.users.filter(u => u.userId !== currentUserId);
  if (otherUsers.length === 0) return [];
  
  // 获取其他用户的消息
  return room.messages.filter(msg => 
    msg.role === 'user' && 
    msg.userId !== currentUserId
  );
}

/**
 * 生成用户ID
 */
function generateUserId() {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 发送系统启动消息（当聊天室满2人时）
 * @param {string} roomCode - 聊天室代码
 * @returns {Object|null} 系统消息对象，如果已发送过则返回null
 */
function sendSystemStartMessage(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.startMessageSent) {
    return null;
  }
  
  const status = checkRoomStatus(roomCode);
  if (status.occupancy < 2) {
    return null;
  }
  
  // 发送系统消息（所有用户可见）
  const systemMsg = saveMessage(roomCode, 'system', SYSTEM_START_MESSAGE, 'system');
  
  // 标记已发送启动消息
  room.startMessageSent = true;
  room.status = ROOM_STATUS.READY;
  
  // 将系统消息添加到所有用户的会话中
  room.users.forEach(user => {
    const session = sessions.get(user.userId);
    if (session) {
      session.messages.push(systemMsg);
    }
  });
  
  return systemMsg;
}

/**
 * 检查聊天室是否可以开始对话（满2人）
 * @param {string} roomCode - 聊天室代码
 * @returns {boolean}
 */
function canStartConversation(roomCode) {
  const status = checkRoomStatus(roomCode);
  return status.occupancy >= 2;
}

module.exports = {
  generateRoomCode,
  getOrCreateRoom,
  checkRoomStatus,
  joinRoom,
  getUserSession,
  saveMessage,
  getRoomMessages,
  getVisibleMessages,
  getOtherUserMessages,
  generateUserId,
  sendSystemStartMessage,
  canStartConversation,
  ROOM_STATUS,
  SYSTEM_START_MESSAGE
};

