require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const db = require('./database/db');
const { scrapeAll } = require('./scrapers/scraper');
const { generateScript, generateAllPending } = require('./generators/gemini');

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

  res.json({ totalArticles, processedArticles, totalScripts, bySource, recent });
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
