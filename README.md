# 👵 老年人动态记忆视频

**拍一张照片 → 说一段语音 → 自动生成动态记忆视频 → 家人扫码留言评论**

一个为老人设计的极简记忆视频生成工具。技术栈：**纯 HTML/CSS/JS + Node.js/Express + SQLite**。

---

## ✨ 核心功能

| 步骤 | 做什么 | 技术实现 |
|------|--------|----------|
| 📷 拍一张 | 大按钮调用手机摄像头 | `<input capture="environment">` |
| 🎙️ 说一段 | 按住录音 | MediaRecorder API |
| 🧠 转文字 | 方言/大白话识别 | 智谱 GLM-ASR |
| 🎨 选风格 | 文艺/喜庆/美丽/怀旧 | 4 个大按钮 |
| 🎬 生成视频 | 图+文字→动态视频 | 火山方舟 Seedance |
| 📱 分享 | 家人扫码看+留言 | 二维码 + 语音/文字评论 |

---

## 🚀 快速开始

### 1. 安装 Node.js 18+

下载地址：https://nodejs.org/

### 2. 安装依赖

```bash
cd elder-memory
npm install
```

### 3. 配置 API Key

项目根目录已有 `.env` 文件，填入两个 Key：

```env
# 智谱 AI：https://bigmodel.cn/usercenter/apikeys
ZHIPU_API_KEY=你的智谱API_Key

# 火山方舟：https://ark.volcengine.com/region:cn-beijing/apikey
VOLC_API_KEY=你的火山方舟API_Key
```

> **没有 Key 也能跑！** 留空时进入模拟模式，语音识别返回示例文字，视频用公开示例链接。

### 4. 启动服务

```bash
npm start
```

浏览器打开 **http://localhost:3000** 即可使用。

手机使用：确保手机和电脑在同一 WiFi，访问电脑的局域网 IP（如 `http://192.168.1.100:3000`）。

---

## 📱 使用流程

### 老人端 (首页 index.html)
1. 点击"📷 拍一张" → 手机自动打开相机
2. 预览照片 → 确认
3. 按住大圆形按钮说话 → 松开结束
4. 看到识别的文字 → 选一个喜欢的风格
5. 等待 1~3 分钟 → 视频自动生成
6. 看视频、点"保存到手机"、截图二维码发给家人

### 家人端 (view.html)
- 扫二维码打开 → 看到视频 + 老人说的话
- 底部输入框打字，或按住 🎙️ 说句话 → 发送留言
- 刷新页面评论仍然在（SQLite 持久化）

---

## 🗂️ 项目结构

```
elder-memory/
├── server.js            # Express 后端 + SQLite + 所有 API
├── package.json
├── .env                 # 环境变量（API Key）
├── data.db              # SQLite 数据库（运行后自动生成）
└── public/
    ├── index.html       # 老人端：拍照→录音→选风格→生成
    └── view.html        # 家人端：扫码看视频+评论
```

---

## 🔌 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/recognize` | 上传音频文件，返回识别文字 |
| POST | `/api/generate` | 提交图片(base64)+文字+风格，创建视频生成任务，同步轮询返回结果 |
| GET | `/api/memory/:id` | 查询视频信息 + 评论列表 |
| POST | `/api/comment` | 添加评论（文字 或 音频） |

### API 细节

**POST /api/recognize**
- Content-Type: `multipart/form-data`
- 字段: `audio` (文件)
- 返回: `{ text: "识别出的文字" }`

**POST /api/generate**
- Content-Type: `application/json`
- 字段: `{ image: "data:image/...;base64,...", text: "故事文字", style: "文艺|喜庆|美丽|怀旧" }`
- 返回: `{ memory_id: "xxx", video_url: "https://..." }`

**GET /api/memory/:id**
- 返回: `{ memory: {...}, comments: [...] }`

**POST /api/comment**
- Content-Type: `multipart/form-data`
- 字段: `memory_id`, `author`, `text`（可选）, `audio`（可选文件）

---

## 🛠️ 技术选型说明

| 需求 | 选择 | 原因 |
|------|------|------|
| 前端 | 原生 HTML/CSS/JS | 单页、移动端优先、零构建、直接运行 |
| 后端 | Node.js + Express | 用户要求、生态成熟 |
| 数据库 | SQLite (better-sqlite3) | 文件数据库、零安装、单文件 |
| 语音识别 | 智谱 GLM-ASR | 支持中文方言、API 简洁 |
| 视频生成 | 火山方舟 Seedance 2.0 mini | 异步 API、图生视频、支持 base64 输入 |
| 二维码 | qrcode (CDN) | 前端生成，内容用当前域名动态拼接 |
| 文件上传 | multer | Express 社区标准 |

### 安全设计
- ✅ 所有第三方 API Key 仅存于后端 `.env`，前端代码零泄露
- ✅ 前端直接访问 `/api/*` 中转，不直连任何云服务
- ✅ SQLite 单文件，无需开端口给外部数据库

---

## 🧪 测试建议

1. **打开首页**，点击"📷 拍一张"（桌面浏览器可用"选择文件"代替）
2. **录音**（如果浏览器要求麦克风权限，点"允许"）
3. **选风格** → 等待视频生成
4. 拿到 **memory_id** 后手动访问 `http://localhost:3000/view.html?memory_id=xxx`
5. 在 view 页面输入文字或录音留言
6. 刷新确认评论持久化

---

## ❓ 常见问题

**Q: 手机访问时"拍一张"按钮没反应？**
A: 某些浏览器需要 `https` 才能调用相机。本地测试可用同一局域网 IP + Chrome 浏览器。

**Q: 视频生成慢？**
A: Seedance 模型一般 1~3 分钟。本项目后端同步轮询 5 分钟。如果 timeout 可查日志看状态。

**Q: 没有 API Key 怎么办？**
A: 全部留空即可进入**模拟模式**，能完整跑通所有 UI 流程（除了语音识别和视频生成结果是模拟的）。

**Q: 数据库在哪里？**
A: 项目根目录的 `data.db` 文件，删除它会清空所有记忆和评论。

---

## 📜 License

MIT
