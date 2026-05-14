# AI News Trend Studio

> OpenAI · Anthropic · Google AI 블로그를 매일 자동 수집하고,  
> Gemini API로 유튜브 **쇼츠(60초)** 및 **롱폼(8~10분)** 대본을 자동 생성하는 시스템

---

## 목차

1. [프로젝트 소개](#1-프로젝트-소개)
2. [주요 기능](#2-주요-기능)
3. [설치 방법](#3-설치-방법)
4. [Gemini API 키 발급](#4-gemini-api-키-발급)
5. [환경 변수 설정](#5-환경-변수-설정)
6. [실행 방법](#6-실행-방법)
7. [사용 방법](#7-사용-방법)
8. [파일 구조](#8-파일-구조)
9. [API 엔드포인트](#9-api-엔드포인트)
10. [문제 해결](#10-문제-해결)

---

## 1. 프로젝트 소개

AI 관련 최신 뉴스를 자동으로 수집하고, Google Gemini AI를 활용해 유튜브 영상 대본을 즉시 생성하는 로컬 웹 애플리케이션입니다.

**수집 대상**
- [OpenAI Blog](https://openai.com/news/)
- [Anthropic Blog](https://www.anthropic.com/news)
- [Google AI Blog](https://blog.google/technology/ai/)

**생성 대본 유형**
- **쇼츠 대본** — 60초 분량, 강렬한 훅으로 시작하는 세로형 영상용
- **롱폼 대본** — 8~10분 분량, 인트로/본론/아웃트로 구성

---

## 2. 주요 기능

| 기능 | 설명 |
|------|------|
| 자동 수집 | 매일 오전 9시, 오후 11시 자동 스크래핑 (한국 시간) |
| 수동 수집 | 버튼 한 번으로 즉시 최신 기사 수집 |
| 대본 생성 | 기사 선택 후 쇼츠/롱폼 대본 즉시 생성 |
| 일괄 생성 | 미처리 기사 전체 대본 자동 생성 |
| 소스 필터 | OpenAI / Anthropic / Google AI 별도 조회 |
| 처리 현황 | 수집/처리 통계 실시간 확인 |

---

## 3. 설치 방법

### 사전 준비

- **Node.js 18 이상** — [nodejs.org](https://nodejs.org) 에서 LTS 버전 설치
- **Git** — [git-scm.com](https://git-scm.com) 에서 설치

설치 확인:
```bash
node -v   # v18.0.0 이상이어야 함
npm -v    # 9.0.0 이상 권장
```

### 저장소 클론 및 패키지 설치

```bash
# 1. 저장소 복제
git clone https://github.com/YOUR_USERNAME/AI-News-Trend-Studio.git

# 2. 폴더 이동
cd AI-News-Trend-Studio

# 3. 패키지 설치
npm install
```

> **Windows 사용자 참고** — `better-sqlite3` 같은 네이티브 모듈은 C++ 컴파일러가 필요합니다.  
> 이 프로젝트는 컴파일 불필요한 `node-sqlite3-wasm`을 사용하므로 Visual Studio 없이 바로 설치됩니다.

---

## 4. Gemini API 키 발급

Gemini API는 **무료**로 사용할 수 있습니다 (일일 요청 한도 내).

1. [Google AI Studio](https://aistudio.google.com/app/apikey) 접속
2. Google 계정으로 로그인
3. **"Create API key"** 클릭
4. 생성된 키를 복사 (`AIzaSy...` 형태)

---

## 5. 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성하고 아래 내용을 입력합니다.

```bash
# .env 파일 직접 생성 (Windows)
copy .env.example .env   # 예시 파일이 있는 경우
# 또는 메모장/VSCode 에서 직접 .env 파일 생성
```

`.env` 파일 내용:

```
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PORT=3001
```

| 변수 | 설명 | 예시 |
|------|------|------|
| `GEMINI_API_KEY` | Google AI Studio에서 발급받은 키 | `AIzaSyABC...` |
| `PORT` | 서버 포트 (기본값 3001) | `3001` |

> **주의** — `.env` 파일은 절대 GitHub에 업로드하지 마세요. `.gitignore`에 이미 포함되어 있습니다.

---

## 6. 실행 방법

```bash
# 서버 시작
npm start
```

서버가 정상 실행되면 터미널에 아래 메시지가 출력됩니다:

```
[db] 초기화 완료 → C:\Users\...\AppData\Local\AINewsTrendStudio\trends.db
AI News Trend Studio running on http://localhost:3001
Scheduler: daily at 09:00 and 23:00 (KST)
```

브라우저에서 접속:

```
http://localhost:3001
```

### 개발 모드 (코드 수정 시 자동 재시작)

```bash
npm run dev
```

> `nodemon`이 파일 변경을 감지하면 서버를 자동으로 재시작합니다.

---

## 7. 사용 방법

### 기사 수집

1. 상단 **"수집 시작"** 버튼 클릭
2. 약 20~30초 후 **"새로고침"** 버튼 클릭
3. 왼쪽 목록에 최신 기사가 표시됨

> 서버가 실행 중이면 **매일 오전 9시 / 오후 11시**에 자동으로 수집됩니다.

### 대본 생성

1. 왼쪽 목록에서 기사 클릭
2. 오른쪽 패널에서 **"쇼츠 대본 생성"** 또는 **"롱폼 대본 생성"** 클릭
3. 수 초 후 대본이 화면에 표시됨
4. 탭을 전환해 쇼츠/롱폼 대본을 비교 가능

### 일괄 대본 생성

- **"미처리 대본 생성"** 버튼 클릭 → 수집된 기사 중 대본이 없는 항목 최대 10개 자동 처리
- 처리 완료된 기사는 목록에서 초록 점(●)으로 표시

### 필터 사용

- **소스 필터** — OpenAI / Anthropic / Google AI 별로 기사 조회
- **처리 상태 필터** — 미처리 / 처리 완료 기사만 조회

---

## 8. 파일 구조

```
AI-News-Trend-Studio/
├── backend/
│   ├── server.js              # Express 서버 + REST API + 스케줄러
│   ├── database/
│   │   └── db.js              # SQLite 초기화 (AppData에 trends.db 자동 생성)
│   ├── scrapers/
│   │   └── scraper.js         # OpenAI/Anthropic/Google AI 블로그 스크래퍼
│   └── generators/
│       └── gemini.js          # Gemini API 대본 생성 로직
├── frontend/
│   └── index.html             # 단일 파일 웹 UI
├── .env                       # API 키 설정 (직접 생성, Git 제외)
├── .gitignore
├── package.json
└── README.md
```

**데이터베이스 위치** (자동 생성, Git 제외)

```
Windows: C:\Users\{사용자명}\AppData\Local\AINewsTrendStudio\trends.db
Mac/Linux: ~/.local/share/AINewsTrendStudio/trends.db (또는 backend/database/)
```

---

## 9. API 엔드포인트

개발자를 위한 REST API 목록입니다.

```
GET  /api/stats
     → 전체 통계 (기사 수, 대본 수, 소스별 현황)

GET  /api/articles?page=1&limit=20&source=Anthropic+Blog&processed=0
     → 기사 목록 (페이지네이션, 소스/처리 상태 필터)

GET  /api/articles/:id
     → 기사 상세 + 연결된 대본 전체

POST /api/scrape
     → 수동 수집 트리거

POST /api/scripts/generate
     Body: { "article_id": 1, "type": "shorts" }  ← type: "shorts" | "longform"
     → 단일 대본 생성

POST /api/scripts/generate-all
     → 미처리 기사 일괄 대본 생성 (최대 10개)
```

---

## 10. 문제 해결

### 서버가 시작되지 않아요

**증상:** `npm start` 실행 후 아무 반응이 없거나 오류 발생

```bash
# 포트 사용 여부 확인 (Windows)
netstat -ano | findstr :3001

# 다른 포트로 변경 (.env 파일 수정)
PORT=3002
```

---

### `database is locked` 오류

**원인:** 이전 서버 프로세스가 비정상 종료되어 잠금 파일이 남아 있음

**해결 (Windows):**

```powershell
# 1. 남은 Node.js 프로세스 종료
Get-Process node | Stop-Process -Force

# 2. 잠금 파일 삭제
Remove-Item "$env:LOCALAPPDATA\AINewsTrendStudio\trends.db.lock" -Recurse -Force

# 3. 서버 재시작
npm start
```

**해결 (Mac/Linux):**

```bash
pkill -f "node backend/server.js"
rm -rf backend/database/trends.db.lock
npm start
```

---

### 기사가 수집되지 않아요

**원인:** 대상 블로그의 HTML 구조 변경 또는 네트워크 차단

- 수집 후 **"새로고침"** 버튼을 눌렀는지 확인 (수집에 20~30초 소요)
- 터미널에서 오류 메시지 확인
- VPN이나 방화벽이 외부 접속을 차단하고 있는지 확인

---

### Gemini API 오류 (`API key not valid`)

- `.env` 파일의 `GEMINI_API_KEY` 값을 다시 확인
- [Google AI Studio](https://aistudio.google.com/app/apikey)에서 키가 활성화 상태인지 확인
- 서버를 **완전히 재시작** (`.env` 변경 사항은 재시작 후 적용)

---

### `npm install` 실패

```bash
# npm 캐시 초기화 후 재시도
npm cache clean --force
npm install
```

---

## 라이선스

MIT License — 자유롭게 사용, 수정, 배포 가능합니다.
