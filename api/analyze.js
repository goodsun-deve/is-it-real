// 가짜뉴스 판별 API — Vercel 서버리스 함수 (외부 라이브러리 0개)
// POST /api/analyze   body: { "input": "검사할 글 또는 뉴스 기사 주소" }

export const config = { maxDuration: 60 };

// ── 설정 ─────────────────────────────────────────────────────────
const MAX_INPUT_CHARS = 12000;   // 입력 최대 길이 (API 비용 폭주 방지)
const MIN_INPUT_CHARS = 20;      // 너무 짧으면 판정 불가
const ARTICLE_FETCH_TIMEOUT = 12000;
const OPENAI_TIMEOUT = 55000;

// 남용 방지: 같은 접속자가 1분에 보낼 수 있는 횟수
const RATE_LIMIT_PER_MIN = 6;
const rateBucket = new Map(); // ip -> [timestamp, ...]

function rateLimited(req) {
  const ip =
    (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers?.['x-real-ip'] ||
    'unknown';
  const now = Date.now();
  const hits = (rateBucket.get(ip) || []).filter((t) => now - t < 60000);
  hits.push(now);
  rateBucket.set(ip, hits);
  if (rateBucket.size > 500) {
    for (const [k, v] of rateBucket) if (!v.some((t) => now - t < 60000)) rateBucket.delete(k);
  }
  return hits.length > RATE_LIMIT_PER_MIN;
}

// 모델 후보. 앞에서부터 시도하고, "없는 모델" 오류면 다음 것으로 넘어감.
const MODEL_CHAIN = [
  process.env.OPENAI_MODEL,
  'gpt-5.6-terra',
  'gpt-5.4',
  'gpt-4o',
].filter(Boolean).filter((m, i, a) => a.indexOf(m) === i);

// ── 판정 결과 스키마 ──────────────────────────────────────────────
const RESULT_SCHEMA = {
  name: 'fake_news_verdict',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'confidence', 'headline', 'reasons', 'checkpoints', 'notice'],
    properties: {
      verdict: {
        type: 'string',
        enum: ['높음', '낮음', '판단보류'],
        description: '이 글이 가짜뉴스/허위정보일 가능성. 사실관계를 확인할 수 없거나 의견·감상 글이면 판단보류.',
      },
      confidence: {
        type: 'integer',
        description: '위 판정에 대한 확신도 0~100 (%)',
      },
      headline: {
        type: 'string',
        description: '결과를 한 문장으로 요약. 40자 이내. 정치 진영을 편들지 않는 중립적 표현.',
      },
      reasons: {
        type: 'array',
        description: '그렇게 판단한 이유 3~5개',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'detail'],
          properties: {
            label: { type: 'string', description: '이유의 짧은 제목 (15자 이내)' },
            detail: { type: 'string', description: '왜 그렇게 봤는지 2~3문장 설명' },
          },
        },
      },
      checkpoints: {
        type: 'array',
        description: '사용자가 직접 확인해 보면 좋을 것 2~4개. 각 항목은 한 문장.',
        items: { type: 'string' },
      },
      notice: {
        type: 'string',
        description: '이 판정의 한계 (예: 최근 사건이라 확인 어려움, 원문이 짧음 등). 없으면 빈 문자열.',
      },
    },
  },
};

const SYSTEM_PROMPT = `너는 한국어 허위정보(가짜뉴스) 분석 도우미다. 사용자가 카카오톡·SNS로 받은 글이나 뉴스 본문을 넣으면, 그 글이 허위정보일 가능성을 분석한다.

[가장 중요한 원칙]
- 너는 정치적으로 완전히 중립이다. 어떤 정당·정치인·진영도 편들거나 불리하게 대하지 않는다.
- 판정 대상은 "주장이 사실인가"이지 "주장이 어느 편인가"가 아니다. 같은 성격의 주장이라면 어느 진영에서 나왔든 똑같은 기준을 적용한다.
- 정치적 의견, 가치판단, 평가("이 정책은 나쁘다")는 참·거짓의 대상이 아니다. 이런 글은 verdict를 "판단보류"로 하고 의견과 사실을 구분해 설명한다.

[판단 기준]
1. 검증 가능한 사실 주장이 있는가? 그 주장이 알려진 사실과 맞는가?
2. 출처가 있는가? 출처가 익명·전언("~카더라", "지인이 말하길")인가?
3. 수치·통계가 맥락 없이 쓰였거나, 원자료를 확인할 수 없는가?
4. 감정을 자극하는 표현, 공포·분노 유발, 긴급 공유 요구("빨리 퍼뜨리세요") 같은 전형적인 유포 패턴이 있는가?
5. 인용문·발언이 맥락에서 잘려 나갔을 가능성이 있는가?
6. 날짜·장소·인물이 구체적인가, 아니면 모호한가?

[모르는 것은 모른다고 한다]
- 네 지식에 없는 최근 사건이면 추측으로 단정하지 말고, verdict를 "판단보류"로 두거나 confidence를 낮추고 notice에 그 한계를 반드시 적는다.
- 확신도(confidence)는 정직하게 매긴다. 근거가 약하면 40~60% 수준으로 낮게 준다.

[말투]
- 일반 시민이 읽는 화면이다. 쉬운 한국어로, 전문용어 없이 쓴다.
- 단정적인 낙인("이건 명백한 선동")을 피하고, 근거를 보여주고 판단은 사용자에게 맡기는 톤으로 쓴다.`;

// ── 유틸 ──────────────────────────────────────────────────────────
function isUrl(s) {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

function isYoutube(u) {
  return /(?:youtube\.com|youtu\.be|m\.youtube\.com)/i.test(u);
}

function decodeBody(buffer, contentType) {
  const head = Buffer.from(buffer.slice(0, 2048)).toString('latin1');
  let charset =
    (contentType && /charset=["']?([\w-]+)/i.exec(contentType)?.[1]) ||
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ||
    'utf-8';
  charset = charset.toLowerCase();
  if (charset === 'ks_c_5601-1987' || charset === 'cp949') charset = 'euc-kr';
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function extractArticle(html) {
  // og:title 또는 <title>
  const title =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ||
    /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ||
    '';

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // 본문으로 보이는 영역이 있으면 그것만
  const main =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(body)?.[1] ||
    /<div[^>]+(?:id|class)=["'][^"']*(?:article|news[-_]?body|content[-_]?body|articleBody|newsct_article)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(body)?.[1];
  if (main && main.replace(/<[^>]+>/g, '').trim().length > 200) body = main;

  const text = body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

  return { title: title.trim(), text };
}

async function fetchArticle(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ARTICLE_FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      throw new Error(`페이지를 열 수 없습니다 (HTTP ${res.status}).`);
    }
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      throw new Error('이 주소는 웹페이지가 아니라서 본문을 읽을 수 없습니다.');
    }
    const buf = await res.arrayBuffer();
    const html = decodeBody(buf, ct);
    return extractArticle(html);
  } finally {
    clearTimeout(timer);
  }
}

// 스키마를 말로 풀어쓴 지시 (json_schema를 못 쓰는 모델용)
const JSON_FALLBACK_INSTRUCTION = `
반드시 아래 형태의 JSON 하나만 출력한다. 설명이나 마크다운 코드블록 없이 JSON만 낸다.
{
  "verdict": "높음" 또는 "낮음" 또는 "판단보류",
  "confidence": 0부터 100 사이의 정수,
  "headline": "결과를 한 문장으로 요약 (40자 이내, 중립적 표현)",
  "reasons": [{"label": "짧은 제목 (15자 이내)", "detail": "2~3문장 설명"}],
  "checkpoints": ["사용자가 직접 확인해 볼 것 (한 문장)"],
  "notice": "이 판정의 한계. 없으면 빈 문자열"
}
reasons는 3~5개, checkpoints는 2~4개를 넣는다.`;

function parseLoose(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced); } catch {}
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}

function normalize(parsed, model) {
  if (!parsed || typeof parsed !== 'object') return null;
  const verdict = ['높음', '낮음', '판단보류'].includes(parsed.verdict) ? parsed.verdict : '판단보류';
  return {
    verdict,
    confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0))),
    headline: String(parsed.headline || ''),
    reasons: (Array.isArray(parsed.reasons) ? parsed.reasons : [])
      .filter((r) => r && (r.label || r.detail))
      .map((r) => ({ label: String(r.label || ''), detail: String(r.detail || '') })),
    checkpoints: (Array.isArray(parsed.checkpoints) ? parsed.checkpoints : []).map(String).filter(Boolean),
    notice: String(parsed.notice || ''),
    _model: model,
  };
}

async function callOpenAI(userContent) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const e = new Error('서버에 OPENAI_API_KEY가 설정되지 않았습니다. Vercel 환경변수를 확인해 주세요.');
    e.status = 500;
    e.code = 'NO_KEY';
    throw e;
  }

  let lastErr = null;
  // 각 모델마다 json_schema를 먼저 쓰고, 안 받아주면 json_object로 한 번 더 시도
  const attempts = [];
  for (const model of MODEL_CHAIN) {
    attempts.push({ model, mode: 'schema' });
    attempts.push({ model, mode: 'object' });
  }

  const deadModels = new Set(); // 존재하지 않는 모델은 두 번 시도하지 않음

  for (const { model, mode } of attempts) {
    if (deadModels.has(model)) continue;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: mode === 'schema' ? SYSTEM_PROMPT : SYSTEM_PROMPT + '\n' + JSON_FALLBACK_INSTRUCTION,
            },
            { role: 'user', content: userContent },
          ],
          response_format:
            mode === 'schema'
              ? { type: 'json_schema', json_schema: RESULT_SCHEMA }
              : { type: 'json_object' },
        }),
      });

      const raw = await res.text();

      if (!res.ok) {
        let msg = raw;
        try {
          msg = JSON.parse(raw)?.error?.message || raw;
        } catch {}
        // 모델이 없거나 권한이 없으면 다음 후보로
        if (
          res.status === 404 ||
          /does not exist|do not have access|unsupported.*model|invalid.*model|model_not_found/i.test(msg)
        ) {
          deadModels.add(model);
          lastErr = new Error(msg);
          continue;
        }
        // 이 모델이 json_schema/response_format을 못 받으면 다음 시도(json_object)로
        if (/response_format|json_schema|unsupported.*parameter|unknown.*parameter/i.test(msg)) {
          lastErr = new Error(msg);
          continue;
        }
        if (res.status === 401) {
          const e = new Error('OpenAI API 키가 올바르지 않습니다. Vercel 환경변수의 키를 다시 확인해 주세요.');
          e.status = 502;
          throw e;
        }
        if (res.status === 429) {
          const e = new Error('OpenAI 사용량 한도에 걸렸습니다. 잠시 후 다시 시도하거나 결제 한도를 확인해 주세요.');
          e.status = 502;
          throw e;
        }
        const e = new Error(`AI 분석 중 오류가 발생했습니다. (${msg.slice(0, 200)})`);
        e.status = 502;
        throw e;
      }

      const data = JSON.parse(raw);
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        lastErr = new Error('빈 응답');
        continue;
      }

      const result = normalize(parseLoose(content), model);
      if (!result) {
        lastErr = new Error('응답을 읽지 못함');
        continue;
      }
      return result;
    } catch (err) {
      if (err.status) throw err;
      if (err.name === 'AbortError') {
        throw Object.assign(new Error('분석 시간이 너무 오래 걸립니다. 글을 조금 줄여서 다시 시도해 주세요.'), {
          status: 504,
        });
      }
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw Object.assign(
    new Error(
      `사용 가능한 AI 모델을 찾지 못했습니다. Vercel 환경변수 OPENAI_MODEL에 쓸 모델 이름을 직접 넣어보세요. (마지막 오류: ${
        lastErr?.message?.slice(0, 200) || '알 수 없음'
      })`
    ),
    { status: 502 }
  );
}

// ── 핸들러 ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST로 요청해 주세요.' });
    return;
  }

  if (rateLimited(req)) {
    res.status(429).json({ error: '조금 빠르게 여러 번 요청하셨습니다. 1분 뒤에 다시 시도해 주세요.' });
    return;
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const input = String(body?.input ?? '').trim();

    if (!input) {
      res.status(400).json({ error: '검사할 글이나 뉴스 주소를 입력해 주세요.' });
      return;
    }

    let sourceLabel = '붙여넣은 글';
    let material = input;

    if (isUrl(input)) {
      if (isYoutube(input)) {
        res.status(400).json({
          error:
            '이번 버전은 유튜브 영상을 직접 분석하지 못합니다. 영상 아래 "더보기"의 설명 글이나, 자막을 복사해서 붙여넣어 주세요.',
        });
        return;
      }
      let article;
      try {
        article = await fetchArticle(input);
      } catch (e) {
        res.status(400).json({
          error:
            (e.name === 'AbortError'
              ? '페이지를 여는 데 시간이 너무 걸립니다.'
              : e.message || '주소를 읽지 못했습니다.') +
            ' 기사 본문을 직접 복사해서 붙여넣으면 분석할 수 있습니다.',
        });
        return;
      }
      if (!article.text || article.text.length < 200) {
        res.status(400).json({
          error:
            '이 주소에서 기사 본문을 찾지 못했습니다. (로그인이 필요하거나 앱 전용 페이지일 수 있어요) 본문을 직접 복사해서 붙여넣어 주세요.',
        });
        return;
      }
      sourceLabel = article.title ? `기사: ${article.title}` : '뉴스 기사';
      material = `[제목] ${article.title}\n[출처 주소] ${input}\n\n[본문]\n${article.text}`;
    }

    if (material.length < MIN_INPUT_CHARS) {
      res.status(400).json({ error: '글이 너무 짧아서 판단하기 어렵습니다. 조금 더 길게 넣어주세요.' });
      return;
    }

    let truncated = false;
    if (material.length > MAX_INPUT_CHARS) {
      material = material.slice(0, MAX_INPUT_CHARS);
      truncated = true;
    }

    const userContent = `아래 내용이 허위정보(가짜뉴스)일 가능성을 분석해 줘.${
      truncated ? '\n(원문이 길어서 앞부분만 잘라서 보냈어. 이 점을 notice에 적어줘.)' : ''
    }\n\n오늘 날짜: ${new Date().toISOString().slice(0, 10)}\n\n----- 분석할 내용 -----\n${material}\n----- 끝 -----`;

    const result = await callOpenAI(userContent);

    res.status(200).json({
      verdict: result.verdict,
      confidence: result.confidence,
      headline: result.headline,
      reasons: Array.isArray(result.reasons) ? result.reasons : [],
      checkpoints: Array.isArray(result.checkpoints) ? result.checkpoints : [],
      notice: result.notice || '',
      source: sourceLabel,
      truncated,
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || '알 수 없는 오류가 발생했습니다.' });
  }
}
