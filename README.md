# ConflictAI - 人机交互实验小程序

## 项目简介

ConflictAI 是一个基于微信小程序的AI聊天实验平台，支持双用户隔离对话。两个用户进入同一个聊天室，分别与AI对话，AI会基于对方用户的观点生成回复，实现智能调解功能。

## 功能特性

### 1. 首页功能
- ✅ 自动生成聊天室代码（CHAT-xxx格式）
- ✅ 手动输入或刷新聊天室代码
- ✅ 选择AI模型类型（叙事型说服者/论证型说服者）
- ✅ 聊天室状态验证（代码有效性、人数限制）
- ✅ 完整的错误提示和加载状态

### 2. 聊天室功能
- ✅ 双用户隔离对话（前端显示为单用户对话）
- ✅ 消息流展示（用户消息/AI回复）
- ✅ 实时AI回复（基于对方用户观点）
- ✅ 消息复制功能
- ✅ 查看Prompt提示词
- ✅ 流式消息展示
- ✅ 错误处理和重试机制

### 3. Prompt管理
- ✅ 可配置的Prompt文件（`utils/prompts.js`）
- ✅ 两种AI模型的不同Prompt策略
- ✅ 支持动态查看和调试

## 项目结构

```
ConflictAI/
├── app.js                 # 小程序入口
├── app.json               # 小程序配置
├── app.wxss               # 全局样式
├── pages/
│   ├── index/             # 首页
│   │   ├── index.js
│   │   ├── index.wxml
│   │   ├── index.wxss
│   │   └── index.json
│   └── chat/              # 聊天室页面
│       ├── chat.js
│       ├── chat.wxml
│       ├── chat.wxss
│       └── chat.json
├── utils/
│   ├── prompts.js         # Prompt配置文件（可修改）
│   ├── roomManager.js     # 聊天室管理逻辑
│   └── api.js             # API调用封装
├── components/
│   └── navigation-bar/    # 导航栏组件
└── README.md              # 项目说明文档
```

## 如何修改Prompt

### 方法一：直接修改配置文件

打开 `utils/prompts.js` 文件，你可以看到两个AI模型的Prompt配置：

1. **叙事型说服者** (`narrative`)
   - `greeting`: AI的问候语
   - `systemPrompt`: AI的系统提示词

2. **论证型说服者** (`argumentative`)
   - `greeting`: AI的问候语
   - `systemPrompt`: AI的系统提示词

修改后保存文件，重新编译小程序即可生效。

### 方法二：在聊天室页面查看

在聊天室页面，点击右上角的"查看提示词"按钮，可以查看当前使用的Prompt内容。

## 技术实现

### 聊天室管理
- 使用内存存储（`roomManager.js`）
- 支持最多3人同时在线
- 自动生成用户ID和聊天室代码

### AI回复逻辑
- 当前为模拟实现（`utils/api.js` 中的 `generateAIResponse` 函数）
- 实际项目中需要替换为真实的AI API调用
- 支持基于对方用户消息生成回复

### 数据流
1. 用户A发送消息 → 保存到聊天室
2. AI基于用户A的消息生成回复 → 发送给用户B
3. 用户B看到的是基于用户A观点的AI回复
4. 反之亦然

## 开发说明

### 本地开发
1. 使用微信开发者工具打开项目
2. 配置小程序AppID（在 `project.config.json` 中）
3. 编译运行

### 部署上线
1. 配置真实的后端API（替换 `utils/api.js` 中的模拟实现）
2. 配置真实的AI服务（替换 `generateAIResponse` 函数）
3. 上传代码并提交审核

## 后续优化建议

1. **后端集成**
   - 将 `roomManager.js` 的逻辑迁移到后端
   - 使用WebSocket实现实时消息推送
   - 添加数据库持久化存储

2. **AI服务集成**
   - 集成OpenAI、Gemini等AI服务
   - 实现流式回复
   - 添加上下文管理

3. **功能增强**
   - 添加消息历史记录
   - 支持图片/文件发送
   - 添加用户身份管理
   - 实现断线重连

4. **体验优化**
   - 添加消息发送动画
   - 优化加载状态提示
   - 添加消息撤回功能
   - 支持消息搜索

## 注意事项

1. **聊天室代码格式**：必须为 `CHAT-xxx` 格式，xxx为3位数字
2. **人数限制**：每个聊天室最多3人
3. **Prompt修改**：修改Prompt后需要重新编译小程序
4. **AI回复**：当前为模拟实现，需要替换为真实AI服务


文件：pages/chat/chat.wxss
/* 第 125-132 行 */
.message-bubble {
  max-width: 70%;  /* 👈 这里控制气泡最大宽度，可以改为 60%、80% 等 */
  padding: 24rpx 32rpx;  /* 👈 这里控制气泡内边距 */
  border-radius: 16rpx;
  position: relative;
  word-wrap: break-word;  /* 👈 允许长单词换行 */
  word-break: break-all;  /* 👈 强制换行（包括单词内部） */
}
/* 第 158-168 行 */
.message-content {
  font-size: 16px;  /* 👈 字体大小 */
  line-height: 1.6;  /* 👈 行高 */
  white-space: pre-wrap;  /* 👈 保留空格和换行 */
  word-wrap: break-word;  /* 👈 允许长单词换行 */
  word-break: break-all;  /* 👈 强制换行 */
  overflow-wrap: break-word;  /* 👈 溢出时换行 */
  display: block;
  width: 100%;  /* 👈 内容宽度占满气泡 */
  box-sizing: border-box;
}

2. 输入框和发送按钮长度控制
文件：pages/chat/chat.wxss
输入框宽度
/* 第 210-222 行 */.input-textarea {  flex: 1;  /* 👈 占据剩余空间，这是关键 */  min-height: 80rpx;  max-height: 200rpx;  padding: 20rpx 24rpx;  /* ... 其他样式 */}
发送按钮宽度
/* 第 224-239 行 */.send-btn {  width: 100rpx;  /* 👈 按钮宽度，可以改为 80rpx、120rpx 等 */  min-width: 100rpx;  /* 👈 最小宽度 */  height: 80rpx;  /* 👈 按钮高度 */  /* ... 其他样式 */}
输入框和按钮之间的间距
/* 第 204-208 行 */.input-wrapper {  display: flex;  align-items: flex-end;  gap: 16rpx;  /* 👈 输入框和按钮之间的间距 */}
调整建议：
让输入框更宽：保持 flex: 1，减小按钮宽度（如 width: 80rpx）
让按钮更宽：增加 width（如 width: 120rpx），输入框会自动缩小
调整间距：修改 gap: 16rpx