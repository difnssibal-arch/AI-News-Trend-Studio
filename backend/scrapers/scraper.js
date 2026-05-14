require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../database/db');

const SOURCES = [
  {
    name: 'OpenAI Blog',
    url: 'https://openai.com/news/',
    parser: parseOpenAI,
  },
  {
    name: 'Anthropic Blog',
    url: 'https://www.anthropic.com/news',
    parser: parseAnthropic,
  },
  {
    name: 'Google AI Blog',
    url: 'https://blog.google/technology/ai/',
    parser: parseGoogleAI,
  },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchPage(url) {
  const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  return cheerio.load(res.data);
}

function parseOpenAI($) {
  const articles = [];
  // 최신 openai.com 구조: 카드 링크
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href.match(/\/(research|blog|news|stories|index)\//)) return;
    const title = cleanText(
      $(el).find('h1, h2, h3, h4, [class*="title"], [class*="heading"]').first().text()
      || $(el).attr('aria-label')
      || $(el).text()
    );
    if (!title || title.length < 10) return;
    const url = href.startsWith('http') ? href : `https://openai.com${href}`;
    articles.push({ title, url });
  });
  return dedupe(articles);
}

function parseAnthropic($) {
  const articles = [];
  $('a[href*="/news/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href === '/news' || href === '/news/') return;
    const title = cleanText(
      $(el).find('h2, h3, [class*="title"], [class*="heading"]').first().text()
      || $(el).text()
    );
    if (!title || title.length < 10) return;
    const url = href.startsWith('http') ? href : `https://www.anthropic.com${href}`;
    articles.push({ title, url });
  });
  return dedupe(articles);
}

function parseGoogleAI($) {
  const articles = [];
  $('article, [class*="article"], [class*="card"], [class*="post"]').each((_, el) => {
    const link = $(el).find('a[href]').first();
    const href = link.attr('href') || '';
    if (!href || href === '#') return;
    const title = cleanText(
      $(el).find('h1, h2, h3, h4, [class*="title"], [class*="heading"]').first().text()
      || link.attr('aria-label')
      || link.text()
    );
    if (!title || title.length < 10) return;
    const url = href.startsWith('http') ? href : `https://blog.google${href}`;
    articles.push({ title, url });
  });
  return dedupe(articles);
}

function cleanText(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function dedupe(articles) {
  const seen = new Set();
  return articles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

const insertArticle = db.prepare(
  'INSERT OR IGNORE INTO articles (source, title, url) VALUES (?, ?, ?)'
);

async function scrapeSource(source) {
  console.log(`[scraper] Fetching ${source.name}...`);
  try {
    const $ = await fetchPage(source.url);
    const articles = source.parser($);
    let saved = 0;
    for (const article of articles.slice(0, 20)) {
      const result = insertArticle.run([source.name, article.title, article.url]);
      if (result.changes) saved++;
    }
    console.log(`[scraper] ${source.name}: ${articles.length} found, ${saved} new`);
    return saved;
  } catch (err) {
    console.error(`[scraper] ${source.name} error:`, err.message);
    return 0;
  }
}

async function scrapeAll() {
  console.log(`[scraper] Starting scrape at ${new Date().toLocaleString('ko-KR')}`);
  let total = 0;
  for (const source of SOURCES) {
    total += await scrapeSource(source);
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`[scraper] Done. ${total} new articles saved.`);
  return total;
}

module.exports = { scrapeAll };

if (require.main === module) {
  scrapeAll().catch(console.error);
}
