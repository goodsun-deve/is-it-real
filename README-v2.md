# v2 — 유튜브 링크 분석 버전 (구매자 코드 필요)

`/v2/` — 기존 공개 링크(`/`)와 구매자 페이지(`/buyer.html`)는 그대로 두고, 그 옆에 추가한 별도 버전입니다.

```
v2/index.html       구매자 코드 + 유튜브 주소 안내가 있는 검사 화면
api/analyze-v2.js   analyze-buyer.js 와 같은 로직 + 유튜브 주소 → Gemini 영상 정리 → 기존 판정 AI
vercel.json         api/analyze-v2.js 항목만 추가
```

기존 파일(index.html, buyer.html, api/analyze.js, api/analyze-buyer.js)은 수정하지 않았습니다.

## 환경변수 (Vercel → Settings → Environment Variables, 추가 후 재배포)

| 이름 | 필수 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | ✅ (유튜브 분석용) | Google AI Studio 에서 발급한 키 |
| `GEMINI_MODEL` | — | 쓰고 싶은 Gemini 모델. 비우면 flash-lite 계열부터 자동 선택 |
| `ACCESS_CODES`, `OPENAI_API_KEY`, `OPENAI_MODEL` | 기존과 동일 | v2도 같은 값을 씁니다 |

`GEMINI_API_KEY`가 없으면 일반 글·기사 검사는 그대로 되고, 유튜브 주소만 "아직 켜져 있지 않습니다" 안내가 나옵니다.

## 동작

1. 입력에서 유튜브 영상 번호를 찾는다 (youtu.be, watch, shorts, live, 카톡 "제목 + 주소" 형태 포함).
2. Gemini 가 영상 앞 30분을 듣고 "영상이 내세우는 주장"을 글로 정리한다 (판정 아님).
3. 그 글을 기존과 같은 기준으로 OpenAI 가 판정한다. 결과에 "AI가 정리한 내용이라 놓친 부분이 있을 수 있음"이 안내된다.

## 한계·운영 주의

- 공개 영상만 가능 (비공개·일부공개·연령제한은 안내 문구 후 붙여넣기로 유도).
- 영상 파일을 카톡으로 직접 받은 경우는 불가 (v3 후보).
- 영상 분석은 글 검사보다 시간이 걸리고 비용도 더 듭니다. Google AI Studio/Cloud 에서 월 예산·알림을 꼭 설정하세요.
- 주소 → Gemini 연동은 Google 문서를 기준으로 작성했고, 실제 키로 한 번 시험해 봐야 합니다.
