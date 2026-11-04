require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
const VOLC_API_KEY = process.env.VOLC_API_KEY;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    image_base64 TEXT, text TEXT, style TEXT,
    video_url TEXT, volc_task_id TEXT,
    status TEXT DEFAULT 'pending', created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL,
    author TEXT DEFAULT '家人', text TEXT, audio_base64 TEXT,
    created_at INTEGER,
    FOREIGN KEY (memory_id) REFERENCES memories(id)
  );
`);

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });
const generateId = () => crypto.randomBytes(8).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============ POST /api/recognize ============
app.post('/api/recognize', upload.single('audio'), async (req, res) => {
  try {
    const audioBuffer = req.file?.buffer;
    if (!audioBuffer) return res.status(400).json({ error: '未收到音频' });
    const audioBase64 = audioBuffer.toString('base64');

    if (!ZHIPU_API_KEY || ZHIPU_API_KEY === '你的智谱API_Key') {
      return res.json({ text: '今天天气真好，我在院子里拍了一张照片，这是我最喜欢的地方。' });
    }

    const formData = new URLSearchParams();
    formData.append('model', 'glm-asr-2512');
    formData.append('file_base64', audioBase64);

    const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${ZHIPU_API_KEY}`,
      },
      body: formData.toString(),
    });
    const data = await resp.json();
    if (resp.ok && data.text) return res.json({ text: data.text });
    res.status(500).json({ error: '识别失败', detail: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ POST /api/generate ============
app.post('/api/generate', async (req, res) => {
  try {
    const { image, text, style } = req.body;
    if (!image || !text || !style) return res.status(400).json({ error: '缺少参数' });

    const memoryId = generateId();
    const stylePrompts = {
      文艺: '文艺风格，画面唯美柔和，光影细腻，镜头缓缓推进，配上优雅的背景音乐。讲述：',
      喜庆: '喜庆欢快的风格，画面明亮热烈，色彩鲜艳，充满幸福感和欢乐气氛。讲述：',
      美丽: '美丽动人的画面，高清质感，色彩饱满，自然流畅的动态效果。讲述：',
      怀旧: '怀旧复古风格，暖色调，电影感滤镜，慢镜头，勾起岁月回忆。讲述：',
    };
    const prompt = (stylePrompts[style] || '') + text;

    db.prepare(`INSERT INTO memories (id,image_base64,text,style,status,created_at)
                VALUES (?,?,?,?,?,?)`).run(memoryId, image, text, style, 'pending', Date.now());

    if (!VOLC_API_KEY || VOLC_API_KEY === '你的火山方舟API_Key') {
      const demoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
      db.prepare('UPDATE memories SET video_url=?, status=? WHERE id=?').run(demoUrl, 'succeeded', memoryId);
      return res.json({ memory_id: memoryId, video_url: demoUrl });
    }

    let imageDataUrl = image.startsWith('data:image/') ? image : `data:image/jpeg;base64,${image}`;

    const createResp = await fetch('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${VOLC_API_KEY}` },
      body: JSON.stringify({
        model: 'doubao-seedance-2-0-mini-260615',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
        generate_audio: true, ratio: 'adaptive', duration: 5, watermark: false,
      }),
    });

    if (!createResp.ok) {
      const err = await createResp.text();
      db.prepare('UPDATE memories SET status=? WHERE id=?').run('failed', memoryId);
      return res.status(500).json({ error: '创建任务失败', detail: err });
    }

    const taskId = (await createResp.json()).id;
    db.prepare('UPDATE memories SET volc_task_id=? WHERE id=?').run(taskId, memoryId);

    // 轮询（最多 5 分钟）
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const poll = await fetch(`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${VOLC_API_KEY}` },
      });
      if (!poll.ok) continue;
      const pData = await poll.json();
      if (pData.status === 'succeeded') {
        const videoUrl = pData.content?.video_url;
        db.prepare('UPDATE memories SET video_url=?, status=? WHERE id=?').run(videoUrl, 'succeeded', memoryId);
        return res.json({ memory_id: memoryId, video_url: videoUrl });
      }
      if (pData.status === 'failed' || pData.status === 'cancelled') {
        db.prepare('UPDATE memories SET status=? WHERE id=?').run('failed', memoryId);
        return res.status(500).json({ error: '生成失败', detail: pData });
      }
    }
    db.prepare('UPDATE memories SET status=? WHERE id=?').run('timeout', memoryId);
    res.status(504).json({ error: '生成超时' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ GET /api/memory/:id ============
app.get('/api/memory/:id', (req, res) => {
  try {
    const m = db.prepare('SELECT id,text,style,video_url,status,created_at FROM memories WHERE id=?').get(req.params.id);
    if (!m) return res.status(404).json({ error: '未找到' });
    const c = db.prepare('SELECT id,author,text,audio_base64,created_at FROM comments WHERE memory_id=? ORDER BY created_at ASC').all(req.params.id);
    res.json({ memory: m, comments: c });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ POST /api/comment ============
app.post('/api/comment', upload.single('audio'), (req, res) => {
  try {
    const { memory_id, author, text } = req.body;
    if (!memory_id) return res.status(400).json({ error: '缺少 memory_id' });
    if (!db.prepare('SELECT id FROM memories WHERE id=?').get(memory_id)) return res.status(404).json({ error: '记忆不存在' });
    const audioBase64 = req.file ? req.file.buffer.toString('base64') : null;
    db.prepare(`INSERT INTO comments (memory_id,author,text,audio_base64,created_at)
                VALUES (?,?,?,?,?)`).run(memory_id, author || '家人', text || null, audioBase64, Date.now());
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`? 已启动：http://localhost:${PORT}`);
});