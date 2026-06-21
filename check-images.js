const db = require('./backend/database/db.js');
const row = db.prepare("SELECT id, title, imageUrls FROM articles WHERE title LIKE '%Responsible Scaling%'").get();
console.log(JSON.stringify(row, null, 2));

const all = db.prepare("SELECT title, imageUrls FROM articles ORDER BY id DESC LIMIT 10").all();
console.log('--- 최근 10개 기사 imageUrls 상태 ---');
all.forEach(r => {
  let count = 0;
  try { count = JSON.parse(r.imageUrls || '[]').length; } catch(e) { count = 'PARSE_ERROR'; }
  console.log((count === 0 ? '[X]' : '[O]') + ' [' + count + '] ' + r.title);
});
