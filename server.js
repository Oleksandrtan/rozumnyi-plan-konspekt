
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ========================================
// НАЛАШТУВАННЯ СЕРВЕРА
// ========================================

const PORT = Number(process.env.PORT) || 10000;

const API_KEY = process.env.GEMINI_API_KEY;

// Використовуємо актуальну модель Google.
// Стара модель gemini-1.5-flash більше не використовується.
const MODEL = 'gemini-3.8-flash';

const API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const PUBLIC_DIR = path.join(__dirname, 'public');

const TIMEOUT = 60000;
const MAX_REQUEST_SIZE = 1000000;

// ========================================
// ТИПИ ФАЙЛІВ
// ========================================

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// ========================================
// ВІДПРАВЛЕННЯ JSON
// ========================================

function sendJson(res, status, data) {
  if (res.headersSent) return;

  const body = JSON.stringify(data);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });

  res.end(body);
}

// ========================================
// ЧИТАННЯ ВХІДНОГО ЗАПИТУ
// ========================================

async function readRequest(req) {
  let body = '';
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > MAX_REQUEST_SIZE) {
      throw new Error('Занадто великий запит. Максимум 1 МБ.');
    }

    body += chunk.toString('utf8');
  }

  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error('Некоректний формат JSON.');
  }
}

// ========================================
// ФОРМУВАННЯ ПРОМПТУ
// ========================================

function makePrompt(data) {
  const subject = String(data.subject || 'Без предмета');
  const grade = String(data.grade || '1 клас');
  const topic = String(data.topic || 'Без теми');
  const type = String(data.type || 'Комбінований урок');
  const extra = String(data.extra || 'Немає');

  return `
Ти — досвідчений український педагог, учитель спеціальної школи та педагог-дефектолог.

Твоє завдання — створити детальний, методично грамотний план-конспект уроку.

ВХІДНІ ДАНІ:

Предмет: ${subject}
Клас: ${grade}
Тема: ${topic}
Тип уроку: ${type}
Додаткові побажання: ${extra}

ОСНОВНІ ВИМОГИ:

1. Пиши виключно українською мовою.
2. Враховуй вік та освітні можливості учнів.
3. Адаптуй зміст до зазначеного класу.
4. Використовуй короткі, зрозумілі речення.
5. Додавай цікаві ігрові вправи.
6. Передбачай практичні завдання.
7. Використовуй наочність та візуальні підказки.
8. Вказуй конкретний час кожного етапу.
9. Формулюй навчальну, розвивальну та виховну мету.
10. Передбачай корекційно-розвиткову роботу.
11. Враховуй особливі освітні потреби учнів.
12. Передбачай індивідуальну допомогу.
13. Не повторюй однакові завдання для різних класів без адаптації.
14. Не вигадуй нормативних вимог та навчальних програм.
15. Формулюй конкретні очікувані результати.

СТРУКТУРА ПЛАНУ-КОНСПЕКТУ:

1. Тема уроку.
2. Мета уроку.
3. Навчальні завдання.
4. Розвивальні завдання.
5. Виховні завдання.
6. Корекційна мета.
7. Обладнання.
8. Очікувані результати.
9. Хід уроку з детальним таймінгом.
10. Підсумок уроку.
11. Рефлексія.
12. Домашнє завдання, якщо воно доречне.

ДЕТАЛІЗАЦІЯ ХОДУ УРОКУ:

Для кожного етапу зазнач:
- Назву етапу.
- Час проведення.
- Дії вчителя.
- Дії учнів.
- Конкретні завдання та вправи.
- Необхідні матеріали.

Оформи відповідь охайно, з підзаголовками, нумерацією та зрозумілими формулюваннями.
`;
}

// ========================================
// ЗАПИТ ДО GEMINI API
// ========================================

async function callGemini(prompt) {
  if (!API_KEY) {
    throw new Error(
      'Не налаштовано GEMINI_API_KEY. Додайте ключ у Render → Environment.'
    );
  }

  if (typeof fetch !== 'function') {
    throw new Error(
      'Для роботи потрібен Node.js версії 18 або новішої.'
    );
  }

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT);

  try {
    console.log('[GEMINI MODEL]', MODEL);
    console.log('[GEMINI URL]', API_URL);

    const response = await fetch(API_URL, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY
      },

      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],

        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096
        }
      }),

      signal: controller.signal
    });

    const raw = await response.text();

    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error(
        `Google повернув некоректну відповідь. HTTP ${response.status}: ${raw.slice(0, 500)}`
      );
    }

    if (!response.ok) {
      const message =
        result.error?.message || 'Невідома помилка Google API';

      throw new Error(
        `Gemini HTTP ${response.status}: ${message}`
      );
    }

    const candidate = result.candidates?.[0];

    if (!candidate) {
      throw new Error(
        'Gemini не повернув результат. Перевірте налаштування API.'
      );
    }

    const answer = candidate.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim();

    if (!answer) {
      throw new Error(
        `Gemini не повернув текст. Причина: ${
          candidate.finishReason || 'невідома'
        }`
      );
    }

    console.log('[GEMINI SUCCESS]', MODEL);

    return answer;

  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        'Час очікування відповіді Gemini вичерпано. Спробуйте ще раз.'
      );
    }

    throw err;

  } finally {
    clearTimeout(timer);
  }
}

// ========================================
// ОБРОБКА СТАТИЧНИХ ФАЙЛІВ
// ========================================

function serveStatic(req, res, pathname) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, {
      error: 'Некоректний шлях до файлу.'
    });
  }

  const relativePath = decodedPath === '/'
    ? 'index.html'
    : decodedPath.replace(/^\/+/, '');

  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  const relative = path.relative(PUBLIC_DIR, filePath);

  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    return sendJson(res, 403, {
      error: 'Доступ заборонено.'
    });
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      console.error('[FILE NOT FOUND]', relativePath);

      if (!res.headersSent) {
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8'
        });

        res.end('Файл не знайдено: ' + relativePath);
      }

      return;
    }

    const ext = path.extname(filePath).toLowerCase();

    const headers = {
      'Content-Type':
        MIME[ext] || 'application/octet-stream',

      'Content-Length': content.length,

      'X-Content-Type-Options': 'nosniff'
    };

    res.writeHead(200, headers);

    if (req.method === 'HEAD') {
      return res.end();
    }

    res.end(content);
  });
}

// ========================================
// ОСНОВНИЙ HTTP-СЕРВЕР
// ========================================

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );

    // Перевірка роботи сервера
    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      url.pathname === '/health'
    ) {
      return sendJson(res, 200, {
        ok: true,
        app: 'rozumnyi-plan-konspekt',
        model: MODEL,
        apiKeyConfigured: Boolean(API_KEY)
      });
    }

    // Генерація плану-конспекту
    if (
      req.method === 'POST' &&
      url.pathname === '/api/generate'
    ) {
      let data;

      try {
        data = await readRequest(req);
      } catch (err) {
        return sendJson(res, 400, {
          error: err.message
        });
      }

      if (!data.subject || !data.topic) {
        return sendJson(res, 400, {
          error: 'Вкажіть предмет і тему уроку.'
        });
      }

      try {
        const prompt = makePrompt(data);

        const answer = await callGemini(prompt);

        return sendJson(res, 200, {
          success: true,
          response: answer
        });

      } catch (err) {
        console.error('[GEMINI ERROR]', err.message);

        return sendJson(res, 502, {
          error: 'Помилка Gemini API',
          details: err.message
        });
      }
    }

    // Віддавання файлів сайту
    if (
      req.method === 'GET' ||
      req.method === 'HEAD'
    ) {
      return serveStatic(req, res, url.pathname);
    }

    return sendJson(res, 405, {
      error: 'Метод не підтримується.'
    });

  } catch (err) {
    console.error('[SERVER ERROR]', err);

    return sendJson(res, 500, {
      error: 'Внутрішня помилка сервера',
      details: err.message
    });
  }
});

// ========================================
// ЗАПУСК
// ========================================

server.listen(PORT, '0.0.0.0', () => {
  console.log('================================');
  console.log('РОЗУМНИЙ ПЛАН-КОНСПЕКТ');
  console.log('Сервер успішно запущено');
  console.log('Порт:', PORT);
  console.log('Модель Gemini:', MODEL);
  console.log('API ключ:', API_KEY ? 'Налаштований' : 'ВІДСУТНІЙ');
  console.log('Адреса API:', API_URL);
  console.log('Папка сайту:', PUBLIC_DIR);
  console.log('================================');
});
