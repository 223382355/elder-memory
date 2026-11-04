require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
const VOLC_API_KEY = process.env.VOLC_API_KEY;

if (!ZHIPU_API_KEY || ZHIPU_API_KEY === '你的智谱API_Key') {
  console.warn('[WARN] ZHIPU_API_KEY 未配置，语音识别接口返回模拟数据');
}
if (!VOLC_API_KEY || VOLC_API_KEY === '你的火山方舟API_Key') {
  console.warn('[WARN] VOLC_API_KEY 未配置，视频生成接口返回模拟数据');
}

// ============ CORS ============
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ============ 中间件 ============
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============ 文件存储（兼容所有平台） ============
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

const MEM_FILE = path.join(DATA_DIR, 'memories.json');
const CM_FILE  = path.join(DATA_DIR, 'comments.json');

function safeRead(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('[DB] read error', file, e.message);
    return {};
  }
}
function safeWrite(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 0), 'utf8');
    return true;
  } catch (e) {
    console.error('[DB] write error', file, e.message);
    return false;
  }
}
function readMems()  { return safeRead(MEM_FILE); }
function writeMems(m){ return safeWrite(MEM_FILE, m); }
function readCms()   { return safeRead(CM_FILE); }
function writeCms(c) { return safeWrite(CM_FILE, c); }

// ============ Multer ============
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const generateId = () => crypto.randomBytes(8).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STYLE_PROMPTS = {
  文艺: '文艺风格，画面唯美柔和，光影细腻，镜头缓缓推进，配优雅背景音乐。讲述：',
  喜庆: '喜庆欢快风格，画面明亮热烈，色彩鲜艳，充满幸福感。讲述：',
  美丽: '美丽动人的画面，高清质感，色彩饱满，自然流畅的动态效果。讲述：',
  怀旧: '怀旧复古风格，暖色调，电影感滤镜，慢镜头，勾起岁月回忆。讲述：'
};

// ============ POST /api/recognize ============
app.post('/api/recognize', upload.single('audio'), async (req, res) => {
  try {
    const audioBuffer = req.file?.buffer;
    if (!audioBuffer) return res.status(400).json({ error: '未收到音频文件' });
    const audioBase64 = audioBuffer.toString('base64');

    if (!ZHIPU_API_KEY || ZHIPU_API_KEY === '你的智谱API_Key') {
      return res.json({ text: '今天天气真好，我在院子里拍了一张照片，这是我最喜欢的地方。' });
    }

    const formData = new URLSearchParams();
    formData.append('model', 'glm-asr-2512');
    formData.append('file_base64', audioBase64);

    const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/audio/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Bearer ${ZHIPU_API_KEY}` },
      body: formData.toString(),
    });
    const data = await resp.json();
    if (resp.ok && data.text) return res.json({ text: data.text });
    res.status(500).json({ error: '识别失败', detail: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ POST /api/generate ============
app.post('/api/generate', async (req, res) => {
  try {
    const { image, text, style } = req.body;
    if (!image || !text || !style) return res.status(400).json({ error: '缺少 image/text/style 参数' });

    const memoryId = generateId();
    const prompt = (STYLE_PROMPTS[style] || '') + text;

    // 存一条 pending 记录
    const mems = readMems();
    mems[memoryId] = {
      id: memoryId, text, style, image_base64: image,
      video_url: null, volc_task_id: null,
      status: 'pending', created_at: Date.now()
    };
    writeMems(mems);

    // 模拟模式
    if (!VOLC_API_KEY || VOLC_API_KEY === '你的火山方舟API_Key') {
      console.log('[模拟] 火山方舟，返回示例视频');
      const demoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
      mems[memoryId].video_url = demoUrl;
      mems[memoryId].status = 'succeeded';
      writeMems(mems);
      return res.json({ memory_id: memoryId, video_url: demoUrl });
    }

    let imageDataUrl = image.startsWith('data:image/') ? image : 'data:image/jpeg;base64,' + image;

    const createResp = await fetch('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VOLC_API_KEY}` },
      body: JSON.stringify({
        model: 'doubao-seedance-2-0-mini-260615',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ],
        generate_audio: true, ratio: 'adaptive', duration: 5, watermark: false
      })
    });

    if (!createResp.ok) {
      const err = await createResp.text();
      console.error('[火山方舟] 创建失败:', createResp.status, err);
      mems[memoryId].status = 'failed';
      writeMems(mems);
      return res.status(500).json({ error: '创建任务失败', detail: err.slice(0, 200) });
    }

    const taskId = (await createResp.json()).id;
    mems[memoryId].volc_task_id = taskId;
    writeMems(mems);

    // 同步轮询（最多 5 分钟）
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const pollResp = await fetch(`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${VOLC_API_KEY}` }
      });
      if (!pollResp.ok) continue;
      const pData = await pollResp.json();
      if (pData.status === 'succeeded') {
        const v = pData.content?.video_url;
        mems[memoryId].video_url = v;
        mems[memoryId].status = 'succeeded';
        writeMems(mems);
        return res.json({ memory_id: memoryId, video_url: v });
      }
      if (pData.status === 'failed' || pData.status === 'cancelled') {
        mems[memoryId].status = 'failed';
        writeMems(mems);
        return res.status(500).json({ error: '视频生成失败: ' + pData.status });
      }
    }

    mems[memoryId].status = 'timeout';
    writeMems(mems);
    res.status(504).json({ error: '视频生成超时' });
  } catch (err) {
    console.error('生成错误:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ GET /api/memory/:id ============
app.get('/api/memory/:id', (req, res) => {
  try {
    const mems = readMems();
    const m = mems[req.params.id];
    if (!m) return res.status(404).json({ error: '未找到' });
    const cms = readCms();
    return res.json({ memory: {
      id: m.id, text: m.text, style: m.style,
      video_url: m.video_url, status: m.status,
      created_at: m.created_at
    }, comments: cms[req.params.id] || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ POST /api/comment ============
app.post('/api/comment', upload.single('audio'), (req, res) => {
  try {
    const { memory_id, author, text } = req.body;
    if (!memory_id) return res.status(400).json({ error: '缺少 memory_id' });

    const mems = readMems();
    if (!mems[memory_id]) return res.status(404).json({ error: '记忆不存在' });

    const cms = readCms();
    const list = cms[memory_id] || [];
    list.push({
      id: list.length + 1,
      memory_id,
      author: author || '家人',
      text: text || null,
      audio_base64: req.file ? req.file.buffer.toString('base64') : null,
      created_at: Date.now()
    });
    cms[memory_id] = list;
    writeCms(cms);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ 启动 ============
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('========================================');
    console.log('  老年人动态记忆视频 - 已启动');
    console.log(`  本机: http://localhost:${PORT}`);
    console.log(`  数据: ${DATA_DIR}`);
    console.log('========================================');
    if (!ZHIPU_API_KEY || ZHIPU_API_KEY === '你的智谱API_Key') console.log('  ⚠️  ZHIPU_API_KEY 未配置（模拟数据）');
    if (!VOLC_API_KEY || VOLC_API_KEY === '你的火山方舟API_Key') console.log('  ⚠️  VOLC_API_KEY 未配置（模拟数据）');
    console.log('========================================');
  });
}

// 导出供 Serverless 平台使用
module.exports = app;
