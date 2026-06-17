require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const db = require('./database/db');
const { scrapeAll } = require('./scrapers/scraper');
const {
  generateScript,
  generateAllPending,
  generateTitleCandidates,
  generateBlogPost,
  generateCardNewsText,
} = require('./generators/gemini');
const { generateNarration, KOREAN_VOICES } = require('./generators/tts');
const { renderShort } = require('./generators/render');

// In-memory render job store: scriptId → { status, progress, message, error, path }
const renderJobs = new Map();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// --- Articles ---

app.get('/api/articles', (req, res) => {
  const { page = 1, limit = 20, source, processed } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const conditions = [];
  const params = [];
  if (source) { conditions.push('source = ?'); params.push(source); }
  if (processed !== undefined) { conditions.push('is_processed = ?'); params.push(Number(processed)); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const articles = db.prepare(
    `SELECT * FROM articles ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all([...params, Number(limit), offset]);

  const { total } = db.prepare(`SELECT COUNT(*) as total FROM articles ${where}`).get([...params]);

  res.json({ articles, total, page: Number(page), limit: Number(limit) });
});

app.get('/api/articles/:id', (req, res) => {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get([req.params.id]);
  if (!article) return res.status(404).json({ error: 'Not found' });

  const scripts = db.prepare(
    'SELECT * FROM scripts WHERE article_id = ? ORDER BY created_at DESC'
  ).all([article.id]);

  res.json({ ...article, scripts });
});

// --- Scripts ---

app.get('/api/scripts', (req, res) => {
  const { type, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const conditions = [];
  const params = [];
  if (type) { conditions.push('s.type = ?'); params.push(type); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const scripts = db.prepare(`
    SELECT s.*, a.title as article_title, a.source, a.url as article_url
    FROM scripts s
    JOIN articles a ON s.article_id = a.id
    ${where}
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all([...params, Number(limit), offset]);

  const { total } = db.prepare(
    `SELECT COUNT(*) as total FROM scripts s ${where}`
  ).get([...params]);

  res.json({ scripts, total });
});

app.post('/api/scripts/generate', async (req, res) => {
  const { article_id, type } = req.body;
  if (!article_id || !type) return res.status(400).json({ error: 'article_id and type required' });
  if (!['shorts', 'longform'].includes(type)) return res.status(400).json({ error: 'type must be shorts or longform' });

  try {
    const result = await generateScript(Number(article_id), type);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scripts/generate-all', async (req, res) => {
  res.json({ message: 'Generating scripts for pending articles...' });
  generateAllPending().catch(console.error);
});

// PATCH: update myCommentary / editingPreset / title
app.patch('/api/scripts/:id', (req, res) => {
  const { myCommentary, editingPreset, title } = req.body;
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!script) return res.status(404).json({ error: 'Script not found' });

  const sets = [];
  const params = [];

  if (title !== undefined) { sets.push('title = ?'); params.push(title); }
  if (editingPreset !== undefined) {
    if (!['A', 'B', 'C'].includes(editingPreset))
      return res.status(400).json({ error: 'editingPreset must be A, B, or C' });
    sets.push('editingPreset = ?'); params.push(editingPreset);
  }
  if (myCommentary !== undefined) {
    sets.push('myCommentary = ?'); params.push(myCommentary);
    sets.push('status = ?'); params.push(myCommentary.trim() ? 'ready' : 'draft');
  }

  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE scripts SET ${sets.join(', ')} WHERE id = ?`).run(params);
  res.json(db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]));
});

// POST: generate title candidates for a script
app.post('/api/scripts/:id/titles', async (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  try {
    const titles = await generateTitleCandidates(script.article_id);
    res.json({ titles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: generate blog post for a script
app.post('/api/scripts/:id/blog', async (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  try {
    const content = await generateBlogPost(script.article_id);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: generate card news text for a script
app.post('/api/scripts/:id/cardnews', async (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  try {
    const content = await generateCardNewsText(script.article_id);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Narration & Render ---

// GET: available TTS voices
app.get('/api/voices', (req, res) => res.json({ voices: KOREAN_VOICES }));

// POST: generate narration audio for a script
app.post('/api/scripts/:id/narration', async (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  if (!(script.myCommentary || '').trim())
    return res.status(400).json({ error: 'myCommentary가 비어있습니다.' });

  try {
    const voiceId = req.body.voiceId || 'Kore';
    const result  = await generateNarration(script.content, voiceId);
    db.prepare('UPDATE scripts SET narrationPath=? WHERE id=?').run([result.audioPath, req.params.id]);
    res.json({ audioPath: result.audioPath, duration: result.duration, silent: !!result.silent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: start full render pipeline
app.post('/api/scripts/:id/render', (req, res) => {
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get([req.params.id]);
  if (!script) return res.status(404).json({ error: 'Script not found' });
  if (!(script.myCommentary || '').trim())
    return res.status(400).json({ error: 'myCommentary가 비어있습니다. 렌더링을 시작할 수 없습니다.' });

  const id = Number(req.params.id);
  if (renderJobs.get(id)?.status === 'rendering')
    return res.status(409).json({ error: '이미 렌더링 중입니다.' });

  const voiceId = req.body.voiceId || 'Kore';
  renderJobs.set(id, { status: 'rendering', progress: 0, message: '시작 중...', error: null, path: null });
  db.prepare('UPDATE scripts SET renderStatus=?, renderProgress=0 WHERE id=?').run(['rendering', id]);

  // Run asynchronously
  renderShort(id, voiceId, (progress, message) => {
    renderJobs.set(id, { status: 'rendering', progress, message, error: null, path: null });
    db.prepare('UPDATE scripts SET renderProgress=? WHERE id=?').run([progress, id]);
    console.log(`[render ${id}] ${progress}% — ${message}`);
  }).then(outputPath => {
    renderJobs.set(id, { status: 'done', progress: 100, message: '완료', error: null, path: outputPath });
  }).catch(err => {
    console.error(`[render ${id}] error:`, err.message);
    renderJobs.set(id, { status: 'error', progress: 0, message: err.message, error: err.message, path: null });
    db.prepare('UPDATE scripts SET renderStatus=? WHERE id=?').run(['error', id]);
  });

  res.json({ status: 'rendering', message: '렌더링을 시작했습니다.' });
});

// GET: poll render status
app.get('/api/scripts/:id/render-status', (req, res) => {
  const id = Number(req.params.id);
  const job = renderJobs.get(id);
  if (job) return res.json(job);

  // Fallback to DB
  const script = db.prepare('SELECT renderStatus, renderProgress, renderPath FROM scripts WHERE id=?').get([id]);
  if (!script) return res.status(404).json({ error: 'Not found' });
  res.json({ status: script.renderStatus || 'idle', progress: script.renderProgress || 0, path: script.renderPath });
});

// GET: stream rendered MP4 for download/preview
app.get('/api/scripts/:id/render-download', (req, res) => {
  const script = db.prepare('SELECT renderPath FROM scripts WHERE id=?').get([req.params.id]);
  if (!script?.renderPath) return res.status(404).json({ error: 'No render found' });
  const fs = require('fs');
  if (!fs.existsSync(script.renderPath)) return res.status(404).json({ error: 'File not found' });
  res.download(script.renderPath, `shorts_${req.params.id}.mp4`);
});

// --- Scraper ---

app.post('/api/scrape', async (req, res) => {
  res.json({ message: 'Scraping started...' });
  scrapeAll().catch(console.error);
});

// --- Stats ---

app.get('/api/stats', (req, res) => {
  const totalArticles = db.prepare('SELECT COUNT(*) as n FROM articles').get([]).n;
  const processedArticles = db.prepare('SELECT COUNT(*) as n FROM articles WHERE is_processed = 1').get([]).n;
  const totalScripts = db.prepare('SELECT COUNT(*) as n FROM scripts').get([]).n;
  const bySource = db.prepare('SELECT source, COUNT(*) as n FROM articles GROUP BY source').all([]);
  const recent = db.prepare('SELECT * FROM articles ORDER BY created_at DESC LIMIT 5').all([]);
  const usage = db.prepare(
    'SELECT COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens FROM api_usage'
  ).get([]);

  res.json({ totalArticles, processedArticles, totalScripts, bySource, recent, usage });
});

// --- Scheduler ---

cron.schedule('0 9 * * *', () => {
  console.log('[cron] 9:00 AM — starting scheduled scrape');
  scrapeAll().then(() => generateAllPending()).catch(console.error);
}, { timezone: 'Asia/Seoul' });

cron.schedule('0 23 * * *', () => {
  console.log('[cron] 11:00 PM — starting scheduled scrape');
  scrapeAll().then(() => generateAllPending()).catch(console.error);
}, { timezone: 'Asia/Seoul' });

app.listen(PORT, () => {
  console.log(`\nAI News Trend Studio running on http://localhost:${PORT}`);
  console.log('Scheduler: daily at 09:00 and 23:00 (KST)\n');
});
