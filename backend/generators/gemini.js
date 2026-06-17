require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const db = require('../database/db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

const persona = require(path.join(__dirname, '../config/persona.json'));

// ── Prompts ──────────────────────────────────────────────────────────────

const SHORTS_PROMPT = (title, summary) => `
당신은 유튜브 쇼츠 대본 전문 작가입니다.
채널: ${persona.characterName} / 캐치프레이즈: "${persona.catchphrase}"
톤: ${persona.tone}

다음 AI 뉴스를 바탕으로 60초 분량의 한국어 쇼츠 대본을 작성하세요.

뉴스 제목: ${title}
${summary ? `요약: ${summary}` : ''}

요구사항:
- 반드시 이 인트로 문구로 시작: "${persona.introTemplate}"
- 총 길이: 150~200자 (60초 기준)
- 첫 3초 안에 시청자를 잡는 강렬한 훅 포함
- 핵심 내용을 간결하고 흥미롭게 전달
- 반드시 이 아웃트로 문구로 마무리: "${persona.outroTemplate}"
- 구어체, 친근한 톤 사용
- 이모지 적절히 활용

대본만 출력하세요 (설명 없이).
`.trim();

const LONGFORM_PROMPT = (title, summary) => `
당신은 유튜브 AI 전문 채널의 대본 작가입니다.
채널: ${persona.characterName} / 캐치프레이즈: "${persona.catchphrase}"
톤: ${persona.tone}

다음 AI 뉴스를 바탕으로 8~10분 분량의 한국어 롱폼 영상 대본을 작성하세요.

뉴스 제목: ${title}
${summary ? `요약: ${summary}` : ''}

구성:
1. [인트로 - 30초] "${persona.introTemplate}" 문구로 시작 + 오늘 다룰 내용 예고
2. [본론 1 - 2분] 뉴스 배경 및 핵심 내용 설명
3. [본론 2 - 3분] 기술적 의미와 업계 영향 분석
4. [본론 3 - 2분] 실제 사용자/개발자 관점에서의 시사점
5. [아웃트로 - 1분] 핵심 요약 + "${persona.outroTemplate}" 문구로 마무리

요구사항:
- 전문적이지만 이해하기 쉬운 언어 사용 (${persona.tone})
- 구체적인 예시와 비유 활용
- 각 섹션 앞에 [섹션명] 태그 표시
- 시청자 참여를 유도하는 질문 2~3개 포함

대본만 출력하세요.
`.trim();

const TITLE_PROMPT = (title, summary) => `
다음 AI 뉴스 기사의 유튜브 제목 후보 10개를 작성하세요.
채널 성격: ${persona.characterName} (${persona.tone})

뉴스 제목: ${title}
${summary ? `요약: ${summary}` : ''}

요구사항:
- 클릭을 유도하는 한국어 제목
- 각 제목은 35자 이내
- 숫자 목록으로만 출력 (1. 제목 형식)
- 설명이나 코멘트 없이 제목만 출력

10개 제목만 출력하세요.
`.trim();

const BLOG_PROMPT = (title, summary) => `
당신은 AI 전문 블로그 작가입니다.
블로그명: ${persona.characterName} / 톤: ${persona.tone}

다음 AI 뉴스를 바탕으로 네이버 블로그 포맷의 글을 작성하세요.

뉴스 제목: ${title}
${summary ? `요약: ${summary}` : ''}

구성:
🔍 [도입] 독자의 흥미를 끄는 도입부 (2~3문장)
📌 [핵심 내용] 뉴스의 핵심을 쉽게 설명 (200~300자)
💡 [의미와 영향] 이 뉴스가 왜 중요한지 (150~200자)
🛠 [실생활 적용] 일반 사용자에게 미치는 영향 (100~150자)
👋 [마무리] "${persona.outroTemplate}"

요구사항:
- 이모지로 섹션 구분
- 전체 600~800자 분량
- ${persona.tone}

블로그 글만 출력하세요.
`.trim();

const CARDNEWS_PROMPT = (title, summary) => `
다음 AI 뉴스를 카드뉴스 10장 구성으로 작성하세요.
채널: ${persona.characterName}

뉴스 제목: ${title}
${summary ? `요약: ${summary}` : ''}

형식:
[카드 1] 표지 — 제목/훅 문구 (15자 이내)
[카드 2] 한 줄 요약 (20자 이내)
[카드 3~8] 핵심 포인트 각 1가지 (본문 30자 이내, 이모지 포함)
[카드 9] "이것만 기억하세요" 한 줄 정리
[카드 10] "${persona.outroTemplate}"

요구사항:
- 각 카드 텍스트만 출력 (디자인 지시 없이)
- "[카드 N]" 태그로 반드시 구분

10장 텍스트만 출력하세요.
`.trim();

// ── DB helpers ────────────────────────────────────────────────────────────

const insertScript = db.prepare(
  "INSERT INTO scripts (article_id, type, content, myCommentary, editingPreset, status) VALUES (?, ?, ?, '', 'A', 'draft')"
);

const markProcessed = db.prepare('UPDATE articles SET is_processed = 1 WHERE id = ?');

function saveUsage(scriptId, usage) {
  db.prepare('INSERT INTO api_usage (script_id, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?)')
    .run([scriptId, MODEL, usage?.input_tokens || 0, usage?.output_tokens || 0]);
}

// ── Core generation ───────────────────────────────────────────────────────

async function generateScript(articleId, type) {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get([articleId]);
  if (!article) throw new Error(`Article ${articleId} not found`);

  const prompt = type === 'shorts'
    ? SHORTS_PROMPT(article.title, article.summary)
    : LONGFORM_PROMPT(article.title, article.summary);

  const maxTokens = type === 'shorts' ? 1024 : 4096;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0].text;
  const scriptId = insertScript.run([articleId, type, content]).lastInsertRowid;
  markProcessed.run([articleId]);
  saveUsage(scriptId, response.usage);

  return { id: scriptId, content, myCommentary: '' };
}

async function generateAllPending() {
  const pending = db.prepare('SELECT * FROM articles WHERE is_processed = 0 LIMIT 10').all([]);
  console.log(`[claude] ${pending.length}개 기사 처리 시작`);

  for (const article of pending) {
    try {
      console.log(`[claude] 대본 생성 중: ${article.title}`);
      await generateScript(article.id, 'shorts');
      await new Promise(r => setTimeout(r, 1000));
      await generateScript(article.id, 'longform');
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[claude] article ${article.id} 오류:`, err.message);
    }
  }
  console.log('[claude] 대본 생성 완료.');
}

// ── Extra generation functions ────────────────────────────────────────────

async function generateTitleCandidates(articleId) {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get([articleId]);
  if (!article) throw new Error(`Article ${articleId} not found`);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: TITLE_PROMPT(article.title, article.summary) }],
  });

  const text = response.content[0].text;
  const titles = text
    .split('\n')
    .map(line => line.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(t => t.length > 0 && t.length <= 100)
    .slice(0, 10);

  return titles;
}

async function generateBlogPost(articleId) {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get([articleId]);
  if (!article) throw new Error(`Article ${articleId} not found`);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: BLOG_PROMPT(article.title, article.summary) }],
  });

  return response.content[0].text;
}

async function generateCardNewsText(articleId) {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get([articleId]);
  if (!article) throw new Error(`Article ${articleId} not found`);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: CARDNEWS_PROMPT(article.title, article.summary) }],
  });

  return response.content[0].text;
}

module.exports = {
  generateScript,
  generateAllPending,
  generateTitleCandidates,
  generateBlogPost,
  generateCardNewsText,
};
