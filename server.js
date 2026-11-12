const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Ключ Gemini (з Google AI Studio: https://aistudio.google.com/app/apikey)
// НЕ плутати з OPENAI_API_KEY чи DEEPSEEK_API_KEY.
const IKEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY;

// Актуальні моделі: gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const PUBLIC_DIR = path.join(__dirname, 'public');
const REQUEST_TIMEOUT_MS = 60_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.txt':  'text/plain; charset=utf-8'
};

function sendJson(res, status, obj) {
  if (res.headersSent) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * Виклик Gemini API.
 * Повертає текст відповіді або кидає помилку з полями status та upstream.
 */
async function callGemini(prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(MODEL)}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Офіційно рекомендований спосіб — заголовок, а не ?key=
        'x-goog-api-key': IKEY
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096
        }
      }),
      signal: controller.signal
    });

    const raw = await apiRes.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* не JSON */ }

    if (!apiRes.ok) {
      const msg =
        parsed?.error?.message ||
        `Gemini API повернув ${apiRes.status}`;
      throw Object.assign(new Error(msg), {
        status: apiRes.status,
        upstream: parsed
      });
    }

    const candidate = parsed?.candidates?.[0];
    const text = candidate?.content?.parts
      ?.map(p => p.text)
      .filter(Boolean)
      .join('');

    if (!text) {
      const finishReason = candidate?.finishReason || 'unknown';
      throw Object.assign(
        new Error(`Gemini не повернув текст (finishReason=${finishReason})`),
        { status: 502, upstream: parsed }
      );
    }

    return text;
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // ---- Health check ----
    if (req.method === 'GET' && u.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        app: 'rozumnyi-plan-konspekt',
        model: MODEL
      });
    }

    // ---- Генерація плану-конспекту ----
    if (req.method === 'POST' && u.pathname === '/api/generate') {
      if (!IKEY) {
        return sendJson(res, 500, {
          error:
            'Не налаштовано GEMINI_API_KEY. Отримайте ключ на ' +
            'https://aistudio.google.com/app/apikey і додайте його ' +
            'у змінні середовища.'
        });
      }

      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1_000_000) {
          return sendJson(res, 413, { error: 'Занадто великий запит' });
        }
      }

      let data;
      try {
        data = JSON.parse(body || '{}');
      } catch {
        return sendJson(res, 400, { error: 'Некоректний JSON' });
      }

      const sub    = String(data.subject || 'Без предмета');
      const cls    = String(data.grade   || '1 клас');
      const topic  = String(data.topic   || 'Без теми');
      const type   = String(data.type    || 'Загальний урок');
      const wishes = String(data.extra   || 'Немає');

      const prompt =
`Ти — досвідчений український педагог-дефектолог.

АУДИТОРІЯ: ${cls} з легким розумовим відставанням (легкими інтелектуальними порушеннями).
ПРЕДМЕТ: ${sub}
ТЕМА: ${topic}
ТИП УРОКУ: ${type}
ПОБАЖАННЯ ТА ОСОБЛИВОСТІ: ${wishes}

Склади детальний план-конспект уроку українською мовою з адаптацією для цих дітей:
- короткі речення;
- яскраві приклади;
- ігрові моменти;
- візуальні підказки;
- чіткі етапи уроку з таймінгом;
- очікувані результати та корекційна мета.`;

      try {
        const text = await callGemini(prompt);
        return sendJson(res, 200, { response: text });
      } catch (err) {
        console.error('[Gemini] error:', err.message);

        if (err.name === 'AbortError') {
          return sendJson(res, 504, {
            error: 'Перевищено час очікування відповіді від Gemini'
          });
        }

        // Типові коди Gemini:
        // 400 — некоректний запит/промпт
        // 401/403 — недійсний ключ або обмеження
        // 404 — модель не знайдена
        // 429 — перевищено ліміт
        // 5xx — збій на боці Google
        return sendJson(res, 502, {
          error: 'Помилка Gemini API',
          status: err.status || 502,
          details: err.upstream?.error?.message || err.message
        });
      }
    }

    // ---- Статика (тільки GET) ----
    if (req.method === 'GET') {
      let uriPath;
      try {
        uriPath = decodeURIComponent(u.pathname);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Bad Request');
      }

      const relUrl = uriPath === '/' ? 'index.html' : uriPath.replace(/^\/+/, '');
      const filePath = path.join(PUBLIC_DIR, relUrl);

      if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Forbidden');
      }

      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Not Found');
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Content-Length': content.length
        });
        res.end(content);
      });
      return;
    }

    // ---- Інші методи ----
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Внутрішня помилка сервера' });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Gemini model: ${MODEL}`);
  console.log(`API key present: ${IKEY ? 'yes' : 'NO — set GEMINI_API_KEY'}`);
});
