require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../database/db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const SHORTS_PROMPT = (title, summary) => `
당신은 유튜브 쇼츠 대본 전문 작가입니다.
다음 AI 뉴스를 바탕으로 60초 분량의 한국어 쇼츠 대본을 작성하세요.

뉴스 제목: ${title}
${summary ? `요약: ${summary}` : ''}

요구사항:
- 총 길이: 150~200자 (60초 기준)
- 첫 3초 안에 시청자를 잡는 강렬한 훅으로 시작
- 핵심 내용을 간결하고 흥미롭게 전달
- 마지막에 구독/좋아요 유도 문구 포함
- 구어체, 친근한 톤 사용
- 이모지 적절히 활용

대본만 출력하세요 (설명 없이).
`.trim();

const LONGFORM_PROMPT = (title, summary) => `
당신은 유튜브 AI 전문 채널의 대본 작가입니다.
다음 AI 뉴스를 바탕으로 8~10분 분량의 한국어 롱폼 영상 대본을 작성하세요.

뉴스 제목: ${title}
${summary ? `요약: ${summary}` : ''}

구성:
1. [인트로 - 30초] 강렬한 훅 + 오늘 다룰 내용 예고
2. [본론 1 - 2분] 뉴스 배경 및 핵심 내용 설명
3. [본론 2 - 3분] 기술적 의미와 업계 영향 분석
4. [본론 3 - 2분] 실제 사용자/개발자 관점에서의 시사점
5. [아웃트로 - 1분] 핵심 요약 + 다음 영상 예고 + 구독 유도

요구사항:
- 전문적이지만 이해하기 쉬운 언어 사용
- 구체적인 예시와 비유 활용
- 각 섹션 앞에 [섹션명] 태그 표시
- 시청자 참여를 유도하는 질문 2~3개 포함

대본만 출력하세요.
`.trim();

const insertScript = db.prepare(
  'INSERT INTO scripts (article_id, type, content) VALUES (?, ?, ?)'
);

const markProcessed = db.prepare('UPDATE articles SET is_processed = 1 WHERE id = ?');

async function generateScript(articleId, type) {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get([articleId]);
  if (!article) throw new Error(`Article ${articleId} not found`);

  const prompt = type === 'shorts'
    ? SHORTS_PROMPT(article.title, article.summary)
    : LONGFORM_PROMPT(article.title, article.summary);

  const result = await model.generateContent(prompt);
  const content = result.response.text();

  const scriptId = insertScript.run([articleId, type, content]).lastInsertRowid;
  markProcessed.run([articleId]);
  return { id: scriptId, content };
}

async function generateAllPending() {
  const pending = db.prepare('SELECT * FROM articles WHERE is_processed = 0 LIMIT 10').all([]);
  console.log(`[gemini] ${pending.length} articles to process`);

  for (const article of pending) {
    try {
      console.log(`[gemini] Generating scripts for: ${article.title}`);
      await generateScript(article.id, 'shorts');
      await new Promise(r => setTimeout(r, 2000));
      await generateScript(article.id, 'longform');
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[gemini] Error for article ${article.id}:`, err.message);
    }
  }
  console.log('[gemini] Done generating scripts.');
}

module.exports = { generateScript, generateAllPending };
