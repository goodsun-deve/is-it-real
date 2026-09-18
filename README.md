# 🔎 진짜일까?

카톡·SNS에서 받은 글이나 뉴스 기사를 넣으면, AI가 허위정보일 가능성과 그 이유를 알려주는 웹서비스.
로그인·결제·데이터베이스 없음. 정적 페이지 1개 + 서버리스 함수 1개.

## 구조

```
index.html          첫 화면 + 결과 화면 (외부 라이브러리 0개)
api/analyze.js      판정 API — OpenAI 호출, 기사 URL 본문 추출
vercel.json         Vercel 설정 (함수 최대 60초)
package.json        Node 20+ 표시용. 설치할 패키지 없음.
```

## 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | OpenAI API 키 (`sk-`로 시작) |
| `OPENAI_MODEL` | — | 쓰고 싶은 모델. 비우면 자동으로 고름 |

`OPENAI_MODEL`이 비어 있으면 `gpt-5.6-terra` → `gpt-5.4` → `gpt-4o` 순서로
쓸 수 있는 모델을 찾는다. 각 모델마다 구조화 출력(json_schema)을 먼저 시도하고,
그 모델이 지원하지 않으면 일반 JSON 모드로 한 번 더 시도한다.

## 로컬에서 돌려보기

```bash
npm i -g vercel
vercel dev
```

`.env.example`을 `.env.local`로 복사하고 키를 넣으면 된다.

## 판정 결과 형식

```json
{
  "verdict": "높음 | 낮음 | 판단보류",
  "confidence": 0,
  "headline": "한 문장 요약",
  "reasons": [{ "label": "짧은 제목", "detail": "설명" }],
  "checkpoints": ["직접 확인해 볼 것"],
  "notice": "이 판정의 한계",
  "source": "붙여넣은 글 | 기사: 제목",
  "truncated": false
}
```

## 이번 버전에 없는 것

로그인·회원가입, 결제, 판정 기록 저장, 화제 순위, SNS 자동 수집,
유튜브 영상 자동 분석(자막 추출은 클라우드 IP가 차단되는 경우가 많아 제외).
