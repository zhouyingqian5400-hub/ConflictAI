// cloudDB.js - 云数据库操作封装
const db = wx.cloud.database();
const _ = db.command;

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
async function getOrCreateRoom(code) {
  try {
    // 先查询是否存在
    const result = await db.collection('rooms').where({
      code: code
    }).get();

    if (result.data.length > 0) {
      return result.data[0];
    }

    // 不存在则创建
    const roomData = {
      code,
      users: [],
      status: 'WAITING',
      startMessageSent: false,
      createdAt: db.serverDate()
    };

    const addResult = await db.collection('rooms').add({
      data: roomData
    });

    return {
      _id: addResult._id,
      ...roomData
    };
  } catch (error) {
    console.error('获取或创建聊天室失败:', error);
    throw error;
  }
}

/**
 * 检查聊天室状态
 */
async function checkRoomStatus(code) {
  try {
    // 使用 get() 方法强制从数据库读取最新数据（不使用缓存）
    // 添加时间戳参数避免缓存
    const result = await db.collection('rooms').where({
      code: code
    }).get();

    if (result.data.length === 0) {
      return { exists: false, occupancy: 0, maxCapacity: 3, status: 'WAITING' };
    }

    const room = result.data[0];
    
    // 确保 users 数组存在，并过滤掉无效的用户对象
    const users = (room.users || []).filter(u => u && u.userId);
    const userCount = users.length;
    
    console.log('[状态检测] 聊天室代码:', code, '用户数量:', userCount, '用户列表:', users.map(u => u.userId));
    
    let status = room.status || 'WAITING';
    
    // 根据实际用户数量更新状态
    if (userCount < 2) {
      status = 'WAITING';
    } else if (userCount >= 2 && !room.startMessageSent) {
      status = 'READY';
    } else if (userCount >= 2 && room.startMessageSent) {
      // 检查是否有用户消息（通过查询 messages 集合）
      try {
        const messagesResult = await db.collection('messages').where({
          roomCode: code,
          role: 'user'
        }).count();
        
        if (messagesResult.total > 0) {
          status = 'ACTIVE';
        } else {
          status = 'READY';
        }
      } catch (msgError) {
        // 如果查询消息失败，根据 startMessageSent 判断
        status = room.startMessageSent ? 'READY' : 'WAITING';
      }
    }

    // 如果状态变化了，更新数据库
    if (status !== room.status) {
      await db.collection('rooms').doc(room._id).update({
        data: {
          status: status
        }
      });
    }

    return {
      exists: true,
      occupancy: userCount,
      maxCapacity: 3,
      status: status
    };
  } catch (error) {
    console.error('检查聊天室状态失败:', error);
    return { exists: false, occupancy: 0, maxCapacity: 3, status: 'WAITING' };
  }
}

/**
 * 加入聊天室
 */
async function joinRoom(code, userId, modelType, userRole = null) {
  try {
    const codePattern = /^CHAT-\d{3}$/;
    if (!codePattern.test(code)) {
      return { success: false, error: '代码无效' };
    }

    const room = await getOrCreateRoom(code);
    
    // 先检查当前状态
    let currentStatus = await checkRoomStatus(code);
    
    if (currentStatus.occupancy >= currentStatus.maxCapacity) {
      return { success: false, error: '聊天室已满' };
    }

    // 重新获取最新的房间数据
    const roomResult = await db.collection('rooms').doc(room._id).get();
    const latestRoom = roomResult.data;
    
    // 检查用户是否已在房间中
    const users = latestRoom.users || [];
    const existingUser = users.find(u => u && u.userId === userId);
    
    if (!existingUser) {
      // 新用户：使用传入的身份
      const newUser = {
        userId,
        modelType,
        userRole: userRole || null, // 保存用户身份：'parent' 或 'child'
        joinedAt: Date.now()
      };

      // 获取当前用户列表并添加新用户
      const updatedUsers = [...users, newUser];
      
      // 更新用户列表
      await db.collection('rooms').doc(room._id).update({
        data: {
          users: updatedUsers
        }
      });
      
      console.log('[加入聊天室] 用户已添加:', userId, '身份:', userRole, '当前用户数:', updatedUsers.length);
      
      // 减少等待时间，从800ms改为300ms，并增加重试机制
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 300)); // 从800ms改为300ms
        
        // 重新检查状态（强制读取最新数据）
        currentStatus = await checkRoomStatus(code);
        
        // 如果读取到的用户数正确，跳出循环
        if (currentStatus.occupancy === updatedUsers.length) {
          console.log('[加入聊天室] 状态已同步，用户数:', currentStatus.occupancy);
          break;
        }
        
        retryCount++;
        console.log('[加入聊天室] 状态未同步，重试:', retryCount, '期望用户数:', updatedUsers.length, '实际用户数:', currentStatus.occupancy);
      }
      
      console.log('[加入聊天室] 更新后状态:', currentStatus);
      
      // 如果满2人且状态为READY，立即更新状态（通知其他用户）
      if (currentStatus.occupancy >= 2 && currentStatus.status === 'READY') {
        await db.collection('rooms').doc(room._id).update({
          data: {
            status: 'READY'
          }
        });
        console.log('[加入聊天室] 状态已更新为READY');
      }
    } else {
      // 用户已存在：如果传入了新身份且与已保存的不同，更新身份
      if (userRole && existingUser.userRole !== userRole) {
        existingUser.userRole = userRole;
        await db.collection('rooms').doc(room._id).update({
          data: {
            users: users
          }
        });
        console.log('[加入聊天室] 用户身份已更新:', userId, '新身份:', userRole);
      } else {
        console.log('[加入聊天室] 用户已存在:', userId, '身份:', existingUser.userRole || '未设置');
      }
    }

    // 返回最新的房间数据
    const updatedRoomResult = await db.collection('rooms').doc(room._id).get();
    
    return { success: true, room: updatedRoomResult.data };
  } catch (error) {
    console.error('加入聊天室失败:', error);
    return { success: false, error: error.message || '加入失败' };
  }
}

/**
 * 保存消息
 */
async function saveMessage(roomCode, userId, message, role = 'user', targetUserId = null) {
  try {
    // 先获取聊天室
    const roomResult = await db.collection('rooms').where({
      code: roomCode
    }).get();

    if (roomResult.data.length === 0) {
      throw new Error('聊天室不存在');
    }

    const room = roomResult.data[0];
    const now = Date.now();
    
    // 系统消息：targetUserId 设为 null，表示所有人可见
    // 其他消息：targetUserId 默认为 userId（发送者）
    const finalTargetUserId = role === 'system' ? null : (targetUserId || userId);
    
    const msg = {
      id: `msg_${now}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      role,
      content: message,
      timestamp: now, // 使用数字时间戳而不是 db.serverDate()
      targetUserId: finalTargetUserId
    };

    // 保存到 messages 集合
    await db.collection('messages').add({
      data: {
        ...msg,
        roomCode: roomCode,
        roomId: room._id,
        createdAt: db.serverDate() // 如果需要服务器时间，可以单独保存
      }
    });

    return msg;
  } catch (error) {
    console.error('保存消息失败:', error);
    throw error;
  }
}

/**
 * 获取聊天室消息（全部消息，用于AI学习）
 */
async function getRoomMessages(roomCode, cursor = 0) {
  try {
    const result = await db.collection('messages').where({
      roomCode: roomCode
    }).orderBy('timestamp', 'desc').limit(100).get();

    // 确保时间戳是数字格式
    const messages = result.data.reverse().slice(cursor).map(msg => ({
      ...msg,
      timestamp: typeof msg.timestamp === 'object' && msg.timestamp.seconds 
        ? msg.timestamp.seconds * 1000 
        : (typeof msg.timestamp === 'number' ? msg.timestamp : Date.now())
    }));

    return messages;
  } catch (error) {
    console.error('获取消息失败:', error);
    return [];
  }
}

/**
 * 获取当前用户可见的消息
 */
async function getVisibleMessages(roomCode, currentUserId) {
  try {
    // 先获取所有消息，然后在内存中过滤（因为云数据库查询条件有限制）
    const result = await db.collection('messages').where({
      roomCode: roomCode
    }).orderBy('timestamp', 'asc').get();

    console.log(`[获取可见消息] 聊天室: ${roomCode}, 当前用户: ${currentUserId}, 总消息数: ${result.data.length}`);

    // 在内存中过滤消息
    const visibleMessages = result.data.filter(msg => {
      // 系统消息：所有人可见（targetUserId 为 null、undefined、空字符串或不存在）
      if (msg.role === 'system') {
        // 系统消息应该对所有用户可见，只要targetUserId不是有效的用户ID
        const targetUserId = msg.targetUserId;
        return !targetUserId || targetUserId === null || targetUserId === undefined || targetUserId === '';
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

    console.log(`[获取可见消息] 过滤后可见消息数: ${visibleMessages.length}, AI消息数: ${visibleMessages.filter(m => m.role === 'ai').length}`);

    // 确保时间戳是数字格式
    return visibleMessages.map(msg => ({
      ...msg,
      timestamp: typeof msg.timestamp === 'object' && msg.timestamp.seconds 
        ? msg.timestamp.seconds * 1000 
        : (typeof msg.timestamp === 'number' ? msg.timestamp : Date.now())
    }));
  } catch (error) {
    console.error('获取可见消息失败:', error);
    return [];
  }
}

/**
 * 获取对方用户的消息（用于AI学习）
 */
async function getOtherUserMessages(roomCode, currentUserId) {
  try {
    const result = await db.collection('messages').where({
      roomCode: roomCode,
      role: 'user',
      userId: _.neq(currentUserId)
    }).orderBy('timestamp', 'asc').get();

    // 确保时间戳是数字格式
    return result.data.map(msg => ({
      ...msg,
      timestamp: typeof msg.timestamp === 'object' && msg.timestamp.seconds 
        ? msg.timestamp.seconds * 1000 
        : (typeof msg.timestamp === 'number' ? msg.timestamp : Date.now())
    }));
  } catch (error) {
    console.error('获取对方消息失败:', error);
    return [];
  }
}

/**
 * 发送系统启动消息
 * 使用数据库事务确保只发送一次（通过先更新标志再检查的方式）
 */
async function sendSystemStartMessage(roomCode) {
  try {
    console.log('[系统消息] 开始检查是否可以发送系统启动消息，聊天室代码:', roomCode);
    
    // 系统启动消息内容 - 可以在这里修改引导语
    const SYSTEM_START_MESSAGE = '听说你最近和家人因为手机使用的问题产生了矛盾，请问能跟我讲讲你对这个矛盾的想法吗？最近一次矛盾是什么样的？你是怎么想的？请尽可能详尽的告诉我，让我更好地了解情况。';
    
    // 首先检查数据库中是否已经存在这条系统消息（消息查重）
    const existingMessages = await db.collection('messages').where({
      roomCode: roomCode,
      role: 'system',
      content: SYSTEM_START_MESSAGE
    }).get();
    
    if (existingMessages.data.length > 0) {
      console.log('[系统消息] 数据库中已存在系统启动消息，跳过发送（消息查重）');
      return { success: false, reason: 'already_exists' };
    }
    
    // 重新获取最新的房间数据（不使用缓存）
    const roomResult = await db.collection('rooms').where({
      code: roomCode
    }).get();

    if (roomResult.data.length === 0) {
      console.log('[系统消息] 聊天室不存在');
      return { success: false, reason: 'room_not_found' };
    }

    const room = roomResult.data[0];
    
    // 检查是否已发送过系统消息（房间标志）
    if (room.startMessageSent) {
      console.log('[系统消息] 房间标志显示已发送过，跳过');
      return { success: false, reason: 'already_sent' };
    }

    // 重新检查状态（确保读取最新数据）
    const status = await checkRoomStatus(roomCode);
    console.log('[系统消息] 当前状态:', status.status, '用户数量:', status.occupancy);

    if (status.occupancy < 2) {
      console.log('[系统消息] 用户数量不足，无法发送');
      return { success: false, reason: 'insufficient_users' };
    }

    // 先设置标志，然后检查消息是否存在
    // 如果消息已存在，说明其他用户已经发送了
    try {
      // 先设置标志（即使可能被其他用户抢先设置）
      await db.collection('rooms').doc(room._id).update({
        data: {
          startMessageSent: true
        }
      });
      
      // 立即检查消息是否存在（防止并发）
      const checkMessages = await db.collection('messages').where({
        roomCode: roomCode,
        role: 'system',
        content: SYSTEM_START_MESSAGE
      }).get();
      
      if (checkMessages.data.length > 0) {
        console.log('[系统消息] 其他用户已抢先发送，跳过（并发保护）');
        return { success: false, reason: 'already_sent_by_other' };
      }
    } catch (updateError) {
      // 如果更新失败，再次检查标志和消息
      const roomCheckResult = await db.collection('rooms').doc(room._id).get();
      if (roomCheckResult.data && roomCheckResult.data.startMessageSent) {
        console.log('[系统消息] 检测到已发送，跳过（并发保护）');
        // 检查消息是否存在
        const checkMessages = await db.collection('messages').where({
          roomCode: roomCode,
          role: 'system',
          content: SYSTEM_START_MESSAGE
        }).get();
        if (checkMessages.data.length > 0) {
          return { success: false, reason: 'already_sent' };
        }
      }
      throw updateError;
    }
    
    // 再次检查消息是否存在（防止在检查和发送之间被其他用户插入）
    const doubleCheckMessages = await db.collection('messages').where({
      roomCode: roomCode,
      role: 'system',
      content: SYSTEM_START_MESSAGE
    }).get();
    
    if (doubleCheckMessages.data.length > 0) {
      console.log('[系统消息] 双重检查发现消息已存在，跳过发送');
      return { success: false, reason: 'already_exists' };
    }
    
    console.log('[系统消息] 开始发送系统启动消息');
    const systemMsg = await saveMessage(roomCode, 'system', SYSTEM_START_MESSAGE, 'system', null);

    // 更新房间状态
    await db.collection('rooms').doc(room._id).update({
      data: {
        status: 'READY'
      }
    });

    console.log('[系统消息] 系统启动消息发送成功:', systemMsg.id);
    return { success: true, message: systemMsg };
  } catch (error) {
    console.error('[系统消息] 发送系统启动消息失败:', error);
    // 如果发送失败，重置标志，允许重试
    try {
      const roomResult = await db.collection('rooms').where({
        code: roomCode
      }).get();
      if (roomResult.data.length > 0) {
        await db.collection('rooms').doc(roomResult.data[0]._id).update({
          data: {
            startMessageSent: false
          }
        });
      }
    } catch (resetError) {
      console.error('[系统消息] 重置标志失败:', resetError);
    }
    return { success: false, reason: 'error', error: error.message };
  }
}

/**
 * 检查是否可以开始对话
 */
async function canStartConversation(roomCode) {
  const status = await checkRoomStatus(roomCode);
  return status.occupancy >= 2;
}

/**
 * 生成用户ID
 */
function generateUserId() {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = {
  generateRoomCode,
  getOrCreateRoom,
  checkRoomStatus,
  joinRoom,
  saveMessage,
  getRoomMessages,
  getVisibleMessages,
  getOtherUserMessages,
  sendSystemStartMessage,
  canStartConversation,
  generateUserId,
  ROOM_STATUS: {
    WAITING: 'WAITING',
    READY: 'READY',
    ACTIVE: 'ACTIVE',
    ENDED: 'ENDED'
  }
};
