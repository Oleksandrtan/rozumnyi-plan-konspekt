const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;

const IKEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';

const REQUEST_TIMEOUT_MS = 60000;
const PUBLIC_DIR = path.resolve(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
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
 */
async function callGemini(prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const apiRes = await fetch(url, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
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

    try {
      parsed = JSON.parse(raw);
    } catch {
      // Відповідь не є JSON
    }

    if (!apiRes.ok) {
      const msg =
        parsed?.error?.message ||
        `Gemini API повернув помилку ${apiRes.status}`;

      throw Object.assign(new Error(msg), {
        status: apiRes.status,
        upstream: parsed
      });
    }

    const candidate = parsed?.candidates?.[0];

    const responseText = candidate?.content?.parts
      ?.map(part => part.text)
      .filter(Boolean)
      .join('');

    if (!responseText) {
      const finishReason =
        candidate?.finishReason || 'unknown';

      throw Object.assign(
        new Error(
          `Gemini не повернув текст. Причина: ${finishReason}`
        ),
        {
          status: 502,
          upstream: parsed
        }
      );
    }

    return responseText;

  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );

    // Перевірка роботи сервера
    if (req.method === 'GET' && u.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        app: 'rozumnyi-plan-konspekt',
        model: MODEL
      });
    }

    // Генерація плану-конспекту
    if (
      req.method === 'POST' &&
      u.pathname === '/api/generate'
    ) {
      if (!IKEY) {
        return sendJson(res, 500, {
          error:
            'Не налаштовано GEMINI_API_KEY. Отримайте ключ на https://aistudio.google.com/app/apikey'
        });
      }

      let body = '';

      for await (const chunk of req) {
        body += chunk.toString();

        if (Buffer.byteLength(body) > 1000000) {
          return sendJson(res, 413, {
            error: 'Занадто великий запит'
          });
        }
      }

      let data;

      try {
        data = JSON.parse(body || '{}');
      } catch {
        return sendJson(res, 400, {
          error: 'Некоректний JSON'
        });
      }

      const sub = String(data.subject || 'Без предмета');
      const cls = String(data.grade || '1 клас');
      const topic = String(data.topic || 'Без теми');
      const type = String(data.type || 'Загальний урок');
      const wishes = String(data.extra || 'Немає');

      const prompt = `
Ти — досвідчений український педагог-дефектолог.

АУДИТОРІЯ: ${cls} з легкими інтелектуальними порушеннями.
ПРЕДМЕТ: ${sub}
ТЕМА: ${topic}
ТИП УРОКУ: ${type}
ПОБАЖАННЯ ТА ОСОБЛИВОСТІ: ${wishes}

Склади детальний план-конспект уроку українською мовою
з адаптацією для цих дітей.

Обов'язково врахуй:
- короткі та зрозумілі речення;
- яскраві приклади з повсякденного життя;
- ігрові моменти;
- візуальні підказки;
- чіткі етапи уроку з таймінгом;
- очікувані результати;
- корекційно-розвиткову мету;
- доступні практичні завдання;
- індивідуальний підхід до учнів.

Структура відповіді:
1. Тема уроку.
2. Мета уроку.
3. Корекційно-розвиткові завдання.
4. Обладнання.
5. Очікувані результати.
6. Хід уроку з розподілом часу.
7. Підсумок уроку.
8. Домашнє завдання (за потреби).

Пиши грамотною українською мовою.
Не використовуй складних формулювань.
`;

      try {
        const text = await callGemini(prompt);

        return sendJson(res, 200, {
          response: text
        });

      } catch (err) {
        console.error('[Gemini] error:', err.message);

        if (err.name === 'AbortError') {
          return sendJson(res, 504, {
            error: 'Перевищено час очікування відповіді Gemini'
          });
        }

       console.error('GEMINI FULL ERROR:', JSON.stringify(err.upstream || {}, null, 2));

return sendJson(res, 502, {
  error: 'Помилка Gemini API',
  status: err.status || 502,
  details: err.upstream?.error?.message || err.message,
  model: MODEL
});
      }
    }

    // Віддача статичних файлів
    if (req.method === 'GET') {
      let uriPath;

      try {
        uriPath = decodeURIComponent(u.pathname);
      } catch {
        res.writeHead(400, {
          'Content-Type': 'text/plain; charset=utf-8'
        });
        return res.end('Bad Request');
      }

      const requestedPath =
        uriPath === '/' ? '/index.html' : uriPath;

      const filePath = path.resolve(
        PUBLIC_DIR,
        `.${requestedPath}`
      );

      const relativePath = path.relative(
        PUBLIC_DIR,
        filePath
      );

      if (
        relativePath.startsWith('..') ||
        path.isAbsolute(relativePath)
      ) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(404, {
            'Content-Type': 'text/plain; charset=utf-8'
          });
          return res.end('Not Found');
        }

        const ext = path.extname(filePath).toLowerCase();

        res.writeHead(200, {
          'Content-Type':
            MIME[ext] || 'application/octet-stream',
          'Content-Length': content.length
        });

        res.end(content);
      });

      return;
    }

    res.writeHead(405, {
      'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end('Method Not Allowed');

  } catch (err) {
    console.error('Server error:', err);

    if (!res.headersSent) {
      sendJson(res, 500, {
        error: 'Внутрішня помилка сервера'
      });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Gemini model: ${MODEL}`);
  console.log(
    `API key present: ${IKEY ? 'yes' : 'NO — set GEMINI_API_KEY'}`
  );
});
