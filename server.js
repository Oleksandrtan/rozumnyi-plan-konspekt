const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GEMINI_API_KEY;

// Назва моделі. Можна змінити через Render Environment.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

// Адреса автоматично формується з назви моделі

const PUBLIC_DIR = path.join(__dirname, 'public');
const TIMEOUT = 60000;

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
  '.ico': 'image/x-icon'
};

// Відправлення JSON
function sendJson(res, status, data) {
  if (res.headersSent) return;

  const body = JSON.stringify(data);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });

  res.end(body);
}

const url = API_URL;
async function callGemini(prompt) {
  if (!API_KEY) {
    throw new Error(
      'Не налаштовано GEMINI_API_KEY. Додайте API-ключ у Render Environment.'
    );
  }

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT);

  try {
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
        `Некоректна відповідь Google. HTTP ${response.status}: ${raw.slice(0, 500)}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Gemini HTTP ${response.status}: ${
          result.error?.message || 'Невідома помилка Google'
        }`
      );
    }

    const candidate = result.candidates?.[0];

    const answer = candidate?.content?.parts
      ?.map(part => part.text || '')
      .join('');

    if (!answer) {
      throw new Error(
        `Gemini не повернув текст. Причина: ${
          candidate?.finishReason || 'невідома'
        }`
      );
    }

    return answer;

  } finally {
    clearTimeout(timer);
  }
}

// Читання запиту
async function readRequest(req) {
  let body = '';
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > 1000000) {
      throw new Error('Занадто великий запит. Максимум 1 МБ.');
    }

    body += chunk.toString('utf8');
  }

  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error('Некоректний JSON у запиті.');
  }
}

// Формування промпту
function makePrompt(data) {
  const subject = String(data.subject || 'Без предмета');
  const grade = String(data.grade || '1 клас');
  const topic = String(data.topic || 'Без теми');
  const type = String(data.type || 'Комбінований урок');
  const extra = String(data.extra || 'Немає');

  return `
Ти — досвідчений український педагог, учитель спеціальної школи та педагог-дефектолог.

Створи детальний, методично грамотний план-конспект уроку.

ВХІДНІ ДАНІ:

Предмет: ${subject}
Клас: ${grade}
Тема: ${topic}
Тип уроку: ${type}
Додаткові побажання: ${extra}

ВИМОГИ:

1. Пиши виключно українською мовою.
2. Враховуй вікові особливості учнів.
3. Адаптуй завдання до зазначеного класу.
4. Використовуй короткі, зрозумілі речення.
5. Додавай ігрові вправи та практичні завдання.
6. Передбачай наочність і візуальні підказки.
7. Вказуй конкретний час кожного етапу.
8. Формулюй мету, навчальні, розвивальні та виховні завдання.
9. Передбачай корекційно-розвиткову роботу.
10. Не повторюй однакові завдання для різних класів без адаптації.
11. Не вигадуй нормативних вимог або навчальних програм.
12. Підсумуй очікувані результати навчання.
13. Враховуй особливі освітні потреби учнів спеціальної школи.
14. Передбачай індивідуальну допомогу учням, якщо вона потрібна.

СТРУКТУРА:

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
12. Домашнє завдання (якщо доречне).

Оформи відповідь охайно, з підзаголовками та нумерованими етапами.
`;
}

// Статичні файли
function serveStatic(req, res, pathname) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, {
      error: 'Некоректний шлях'
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
      error: 'Доступ заборонено'
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

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'X-Content-Type-Options': 'nosniff'
    });

    if (req.method === 'HEAD') {
      return res.end();
    }

    res.end(content);
  });
}

// Основний сервер
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

        console.log('[GEMINI SUCCESS]', MODEL);

        return sendJson(res, 200, {
          success: true,
          response: answer
        });

      } catch (err) {
        console.error('[GEMINI ERROR]', err);

        if (err.name === 'AbortError') {
          return sendJson(res, 504, {
            error: 'Gemini не відповів вчасно. Спробуйте ще раз.'
          });
        }

        return sendJson(res, 502, {
          error: 'Помилка Gemini API',
          details: err.message
        });
      }
    }

    // Віддавання сайту та інших файлів
    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, url.pathname);
    }

    return sendJson(res, 405, {
      error: 'Метод не підтримується'
    });

  } catch (err) {
    console.error('[SERVER ERROR]', err);

    return sendJson(res, 500, {
      error: 'Внутрішня помилка сервера',
      details: err.message
    });
  }
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
  console.log('--------------------------------');
  console.log('Розумний план-конспект запущено');
  console.log('Порт:', PORT);
  console.log('Модель:', MODEL);
  console.log('API ключ:', API_KEY ? 'Налаштований' : 'ВІДСУТНІЙ');
  console.log('--------------------------------');
});
