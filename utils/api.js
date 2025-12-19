// API工具函数
// 在实际项目中，这里应该调用真实的后端API
// 一、引入工具
const { 
  checkRoomStatus, 
  joinRoom, 
  getRoomMessages,
  getVisibleMessages,
  getOtherUserMessages,
  saveMessage,
  canStartConversation
} = require('./cloudDB'); // 改为 cloudDB
const { PROMPTS } = require('./prompts');
const db = wx.cloud.database();

// DeepSeek API 配置
const DEEPSEEK_API_KEY = 'sk-59a1c4977119486b913d45a157a08f8a';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * 使用 wx.request 调用 DeepSeek API
 * @param {Array} messages - 消息数组
 * @param {Object} options - 可选参数（temperature, max_tokens等）
 * @returns {Promise} 返回 API 响应
 */
function callDeepSeekAPI(messages, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: DEEPSEEK_API_URL,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      data: {
        model: 'deepseek-chat',
        messages: messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 2000
      },
      success: (res) => {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error(`API 请求失败: ${res.statusCode} - ${res.data?.error?.message || res.errMsg || '未知错误'}`));
        }
      },
      fail: (err) => {
        reject(new Error(`网络请求失败: ${err.errMsg || '未知错误'}`));
      }
    });
  });
}

/**
 * 检查聊天室状态
 */
async function checkRoom(code) {
  try {
    const status = await checkRoomStatus(code); // 直接 await，不需要 setTimeout
    return status;
  } catch (error) {
    console.error('检查聊天室状态失败:', error);
    return { exists: false, occupancy: 0, maxCapacity: 3, status: 'WAITING' };
  }
}

/**
 * 加入聊天室
 */
async function joinChatRoom(code, userId, modelType, userRole = null) {
  try {
    const result = await joinRoom(code, userId, modelType, userRole); // 传入用户身份
    return result;
  } catch (error) {
    console.error('加入聊天室失败:', error);
    return { success: false, error: error.message || '加入失败' };
  }
}

/**
 * 获取聊天室消息（全部消息，用于AI学习）
 */
async function fetchMessages(roomCode, cursor = 0) {
  try {
    const messages = await getRoomMessages(roomCode, cursor);
    return messages;
  } catch (error) {
    console.error('获取消息失败:', error);
    return [];
  }
}

/**
 * 获取当前用户可见的消息（消息过滤）
 */
async function fetchVisibleMessages(roomCode, userId, cursor = 0) {
  try {
    const messages = await getVisibleMessages(roomCode, userId);
    // 确保 messages 是数组
    if (!Array.isArray(messages)) {
      console.error('getVisibleMessages 返回的不是数组:', messages);
      return [];
    }
    return messages.slice(cursor);
  } catch (error) {
    console.error('获取可见消息失败:', error);
    return [];
  }
}

/**
 * 发送消息到AI
 * 调用 DeepSeek API 生成AI回复
 * 如果AI回复超过250字，自动分两次发送
 */
async function sendMessageToAI(roomCode, userId, userMessage, modelType) {
  return new Promise(async (resolve, reject) => {
    try {
      // 检查是否可以开始对话（必须满2人）
      if (!canStartConversation(roomCode)) {
        reject(new Error('聊天室人数不足，无法开始对话'));
        return;
      }
      
      // 保存用户消息（role='user', targetUserId=userId）
      await saveMessage(roomCode, userId, userMessage, 'user', userId);
      
      // 获取对方用户的消息（用于AI学习）
      const otherMessages = await getOtherUserMessages(roomCode, userId);
      
      // 获取当前用户的历史消息（用于构建完整的对话历史）
      const currentUserMessages = await getCurrentUserMessages(roomCode, userId);
      
      // 调用 DeepSeek API 生成AI回复，传入当前用户ID和房间代码（用于获取身份）
      const aiResponse = await generateAIResponse(
        userMessage, 
        otherMessages,
        currentUserMessages, // 传入当前用户的历史消息
        modelType,
        userId,  // 传入当前用户ID
        roomCode // 传入房间代码，用于获取用户身份
      );
      
      // 检查AI回复长度，如果超过250字，分两次发送
      const MAX_LENGTH = 220;
      if (aiResponse.length <= MAX_LENGTH) {
        // 不超过220字，直接保存
        // 注意：AI消息的userId应该是'ai'，targetUserId是接收回复的用户ID
        const aiMessage = await saveMessage(roomCode, 'ai', aiResponse, 'ai', userId);
        console.log('[发送消息到AI] AI消息保存成功:', aiMessage.id, 'targetUserId:', aiMessage.targetUserId);
        resolve(aiMessage);
      } else {
        // 超过220字，分成两部分发送
        const firstPart = aiResponse.substring(0, MAX_LENGTH);
        const secondPart = aiResponse.substring(MAX_LENGTH);
        
        // 保存第一部分 - userId改为'ai'，targetUserId是接收回复的用户ID
        const firstMessage = await saveMessage(roomCode, 'ai', firstPart, 'ai', userId);
        
        // 等待一小段时间，然后发送第二部分
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 保存第二部分 - userId改为'ai'，targetUserId是接收回复的用户ID
        const secondMessage = await saveMessage(roomCode, 'ai', secondPart, 'ai', userId);
        
        // 返回最后一条消息（第二部分）
        resolve(secondMessage);
      }
    } catch (error) {
      console.error('[发送消息到AI] 发生错误:', error);
      console.error('[发送消息到AI] 错误堆栈:', error.stack);
      reject(error);
    }
  });
}

/**
 * 获取用户身份
 */
async function getUserRole(roomCode, userId) {
  try {
    const roomResult = await db.collection('rooms').where({
      code: roomCode
    }).get();
    
    if (roomResult.data.length === 0) {
      return null;
    }
    
    const room = roomResult.data[0];
    const user = (room.users || []).find(u => u && u.userId === userId);
    return user ? user.userRole : null;
  } catch (error) {
    console.error('获取用户身份失败:', error);
    return null;
  }
}

/**
 * 获取对方用户身份
 */
async function getOtherUserRole(roomCode, userId) {
  try {
    const roomResult = await db.collection('rooms').where({
      code: roomCode
    }).get();
    
    if (roomResult.data.length === 0) {
      return null;
    }
    
    const room = roomResult.data[0];
    const otherUser = (room.users || []).find(u => u && u.userId !== userId);
    return otherUser ? otherUser.userRole : null;
  } catch (error) {
    console.error('获取对方用户身份失败:', error);
    return null;
  }
}

/**
 * 获取当前用户的消息（用于构建对话历史）
 */
async function getCurrentUserMessages(roomCode, currentUserId) {
  try {
    const result = await db.collection('messages').where({
      roomCode: roomCode,
      role: 'user',
      userId: currentUserId
    }).orderBy('timestamp', 'asc').get();

    // 确保时间戳是数字格式
    return result.data.map(msg => ({
      ...msg,
      timestamp: typeof msg.timestamp === 'object' && msg.timestamp.seconds 
        ? msg.timestamp.seconds * 1000 
        : (typeof msg.timestamp === 'number' ? msg.timestamp : Date.now())
    }));
  } catch (error) {
    console.error('获取当前用户消息失败:', error);
    return [];
  }
}

/**
 * 生成AI回复
 * 使用 DeepSeek API 生成真实的AI回复（通过 wx.request）
 */
async function generateAIResponse(userMessage, otherMessages, currentUserMessages, modelType, currentUserId, roomCode) {
  try {
    // 获取对应模型类型的系统提示词
    const promptConfig = PROMPTS[modelType];
    if (!promptConfig) {
      throw new Error(`未知的模型类型: ${modelType}`);
    }
    
    // 获取当前用户和对方用户的身份
    const currentUserRole = await getUserRole(roomCode, currentUserId);
    const otherUserRole = await getOtherUserRole(roomCode, currentUserId);
    
    const currentUserRoleLabel = currentUserRole === 'parent' ? '家长' : (currentUserRole === 'child' ? '孩子' : '用户');
    const otherUserRoleLabel = otherUserRole === 'parent' ? '家长' : (otherUserRole === 'child' ? '孩子' : '对方用户');
    
    // 计算当前是第几轮对话（当前用户发送的消息数 + 1）
    const currentRound = (currentUserMessages ? currentUserMessages.length : 0) + 1;
    
    // 每3轮重新强调身份（第1轮、第4轮、第7轮...）
    const needReconfirmIdentity = (currentRound - 1) % 3 === 0;
    
    // 构建系统提示词，明确对话对象和身份
    let systemPromptWithContext = `${promptConfig.systemPrompt}

重要提示：
- 你正在与【${currentUserRoleLabel}】（用户ID: ${currentUserId}）进行对话
- 对方用户是【${otherUserRoleLabel}】，其消息仅作为背景信息参考
- 在回复中使用"你"时，必须指代【${currentUserRoleLabel}】（用户ID: ${currentUserId}）
- 绝对不要将"你"指代【${otherUserRoleLabel}】`;
    
    // 每3轮重新强调身份
    if (needReconfirmIdentity) {
      systemPromptWithContext += `

【身份重新确认 - 第${currentRound}轮对话】
- 当前对话对象：【${currentUserRoleLabel}】（用户ID: ${currentUserId}）
- 对方用户：【${otherUserRoleLabel}】
- 请再次确认：你正在与【${currentUserRoleLabel}】对话，回复中的"你"必须指代【${currentUserRoleLabel}】
- 绝对不要将"你"指代【${otherUserRoleLabel}】`;
    }
    
    // 构建消息历史（按时间顺序组织）
    const messages = [
      {
        role: 'system',
        content: systemPromptWithContext
      }
    ];
    
    // 构建完整的对话历史（按时间顺序）
    // 需要合并当前用户的消息、对方用户的消息和AI的回复
    const allMessages = [];
    
    // 获取所有消息（包括AI回复），按时间排序
    const allRoomMessages = await getRoomMessages(roomCode);
    const sortedMessages = allRoomMessages.sort((a, b) => a.timestamp - b.timestamp);
    
    // 智能选择消息历史：优先保留最近的对话，但确保包含完整的对话上下文
    // 10轮对话 = 10条用户消息 + 10条AI回复 = 20条，加上系统消息 = 21条
    // 为了安全，保留最近30条消息，确保不会丢失重要上下文
    const MAX_HISTORY_MESSAGES = 40;
    const recentMessages = sortedMessages.slice(-MAX_HISTORY_MESSAGES);
    
    console.log(`[AI回复] 总消息数：${sortedMessages.length}，保留最近${recentMessages.length}条消息`);
    
    // 构建对话历史，明确标注每条消息的发送者身份
    recentMessages.forEach(msg => {
      if (msg.role === 'user') {
        // 用户消息：判断是当前用户还是对方用户
        if (msg.userId === currentUserId) {
          // 当前用户的历史消息（不包括刚发送的这条）
          allMessages.push({
            role: 'user',
            content: `[${currentUserRoleLabel}的消息] ${msg.content}`
          });
        } else {
          // 对方用户的消息
          allMessages.push({
            role: 'user',
            content: `[${otherUserRoleLabel}的消息，仅作为背景参考] ${msg.content}`
          });
        }
      } else if (msg.role === 'ai' && msg.targetUserId === currentUserId) {
        // AI回复给当前用户的消息
        allMessages.push({
          role: 'assistant',
          content: msg.content
        });
      }
    });
    
    // 添加当前用户的最新消息（这条消息刚发送，还没有保存到数据库）
    allMessages.push({
      role: 'user',
      content: `[${currentUserRoleLabel}的消息] ${userMessage}`
    });
    
    console.log(`[AI回复] 构建消息历史，共${allMessages.length}条消息，当前轮次：${currentRound}`);
    
    // 将对话历史添加到消息数组
    messages.push(...allMessages);
    
    // 调用 DeepSeek API（使用 wx.request）
    // 计算消息总长度（用于调试）
    const totalMessageLength = JSON.stringify(messages).length;
    const estimatedTokens = Math.ceil(totalMessageLength / 4); // 粗略估算：1 token ≈ 4字符
    
    console.log(`[AI回复] 准备调用API，消息总数：${messages.length}，估算token数：${estimatedTokens}`);
    
    // 如果消息太长，给出警告但继续尝试
    if (estimatedTokens > 8000) {
      console.warn(`[AI回复] 警告：消息历史可能过长（估算${estimatedTokens} tokens），可能导致API调用失败`);
    }
    
    let completion;
    let aiResponse;
    
    try {
      completion = await callDeepSeekAPI(messages, {
        temperature: 0.7,
        max_tokens: 2000 // 增加max_tokens，确保能返回完整回复
      });
      
      console.log(`[AI回复] API调用成功，返回数据：`, completion);
      
      // 提取AI回复内容
      aiResponse = completion.choices?.[0]?.message?.content;
      
      if (!aiResponse) {
        console.error('[AI回复] API返回空回复，完整响应：', JSON.stringify(completion, null, 2));
        throw new Error('AI API 返回了空回复');
      }
      
      console.log(`[AI回复] 成功获取AI回复，长度：${aiResponse.length}字符`);
      
      // 检查是否因为token限制被截断
      if (completion.choices?.[0]?.finish_reason === 'length') {
        console.warn('[AI回复] 警告：AI回复可能因token限制被截断');
      }
      
    } catch (apiError) {
      // 如果是token相关的错误，提供更详细的错误信息
      if (apiError.message && (apiError.message.includes('token') || apiError.message.includes('length') || apiError.message.includes('400'))) {
        console.error('[AI回复] Token相关错误，尝试减少消息历史:', apiError.message);
        // 如果是因为token过多，尝试只保留最近15条消息
        const reducedMessages = sortedMessages.slice(-15);
        const reducedAllMessages = [];
        
        reducedMessages.forEach(msg => {
          if (msg.role === 'user') {
            if (msg.userId === currentUserId) {
              reducedAllMessages.push({
                role: 'user',
                content: `[${currentUserRoleLabel}的消息] ${msg.content}`
              });
            } else {
              reducedAllMessages.push({
                role: 'user',
                content: `[${otherUserRoleLabel}的消息，仅作为背景参考] ${msg.content}`
              });
            }
          } else if (msg.role === 'ai' && msg.targetUserId === currentUserId) {
            reducedAllMessages.push({
              role: 'assistant',
              content: msg.content
            });
          }
        });
        
        reducedAllMessages.push({
          role: 'user',
          content: `[${currentUserRoleLabel}的消息] ${userMessage}`
        });
        
        const reducedMessagesArray = [
          {
            role: 'system',
            content: systemPromptWithContext
          },
          ...reducedAllMessages
        ];
        
        console.log(`[AI回复] 使用减少后的消息历史，共${reducedMessagesArray.length}条消息`);
        completion = await callDeepSeekAPI(reducedMessagesArray, {
          temperature: 0.7,
          max_tokens: 2000
        });
        
        aiResponse = completion.choices?.[0]?.message?.content;
        if (!aiResponse) {
          throw new Error('AI API 返回了空回复（使用减少后的消息历史）');
        }
        
        console.log(`[AI回复] 使用减少后的消息历史成功获取AI回复，长度：${aiResponse.length}字符`);
      } else {
        // 如果不是token错误，继续抛出
        throw apiError;
      }
    }
    
    // 清理AI回复中的身份标签（括号内的内容），避免用户看到
    // 移除类似 "(家长)"、"(孩子)"、"(当前对话对象: 孩子)" 等格式
    aiResponse = aiResponse
      .replace(/^\([^)]*\)\s*/g, '') // 移除开头的括号标签，如 "(家长) "
      .replace(/\(当前对话对象[^)]*\)\s*/g, '') // 移除 "(当前对话对象: 孩子)" 等
      .replace(/\(家长\)\s*/g, '') // 移除 "(家长)"
      .replace(/\(孩子\)\s*/g, '') // 移除 "(孩子)"
      .replace(/\[当前用户[^\]]*\]\s*/g, '') // 移除 "[当前用户的消息]" 等
      .replace(/\[对方用户[^\]]*\]\s*/g, '') // 移除 "[对方用户的消息]" 等
      .trim(); // 移除首尾空白
    
    return aiResponse;
    
  } catch (error) {
    // 错误处理：如果API调用失败，返回降级回复
    console.error('[生成AI回复] DeepSeek API 调用失败:', error.message);
    console.error('[生成AI回复] 错误详情:', error);
    console.error('[生成AI回复] 错误堆栈:', error.stack);
    
    // 构建降级回复（使用原有的模拟逻辑）
    let context = '';
    if (otherMessages && otherMessages.length > 0) {
      context = `基于对方用户的观点：${otherMessages.map(m => m.content || m).join('；')}，`;
    }
    
    const fallbackResponses = {
      narrative: `${context}我理解你的观点。让我分享一个相关的经历：曾经有一位朋友面临类似的困境，通过深入思考和积极行动，最终找到了解决方案。这个故事告诉我们，面对挑战时，保持开放的心态和持续的努力很重要。从逻辑上看，相关研究也表明，这种方法的有效性得到了验证。`,
      argumentative: `${context}从逻辑分析的角度，你的观点有以下几个关键点值得深入探讨。首先，相关数据显示这种方法在大多数情况下是有效的。其次，从理论框架来看，这符合现有的研究结论。让我用一个例子来说明：曾经有一位朋友在类似情况下，通过系统性的方法解决了问题。这证明了理论与实践的结合是可行的。`
    };
    
    return fallbackResponses[modelType] || '我理解你的观点，让我思考一下如何回应。';
  }
}

/**
 * 流式AI回复（如果需要）
 */
async function* streamAIResponse(roomCode, userId, userMessage, modelType) {
  // 这里可以实现流式回复
  // 目前返回完整回复
  const response = await sendMessageToAI(roomCode, userId, userMessage, modelType);
  yield response.content;
}

module.exports = {
  checkRoom,
  joinChatRoom,
  fetchMessages,
  fetchVisibleMessages,
  sendMessageToAI,
  streamAIResponse
};