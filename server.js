'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ======================================================
// НАЛАШТУВАННЯ
// ======================================================

const PORT = Number(process.env.PORT) || 10000;
const API_KEY = process.env.GEMINI_API_KEY;

// Основна модель — gemini-2.5-flash (залишаємо за бажанням)
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Резервна модель — gemini-2.5-pro
const FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-pro';

// Аварійна модель — gemini-2.5-flash-lite
const EMERGENCY_MODEL =
  process.env.GEMINI_EMERGENCY_MODEL || 'gemini-2.5-flash-lite';

// Кінцевий пункт API (v1beta — стандартний для Gemini API)
const API_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models/';

const PUBLIC_DIR = path.join(__dirname, 'public');
const REQUEST_TIMEOUT_MS = 60000;
const MAX_REQUEST_SIZE = 1000000;

const MAX_ATTEMPTS_PRIMARY = 5;
const MAX_ATTEMPTS_FALLBACK = 3;
const MAX_ATTEMPTS_EMERGENCY = 2;

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

// ======================================================
// ДОПОМІЖНІ ФУНКЦІЇ
// ======================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendJson(res, status, data, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

async function readRequest(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_SIZE) {
      const error = new Error('Занадто великий запит. Максимум 1 МБ.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw || '{}');
  } catch {
    const error = new Error('Некоректний формат JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function cleanInput(value, fallback, maxLength = 4000) {
  const result = String(value ?? '').trim();
  return (result || fallback).slice(0, maxLength);
}

// ======================================================
// ФОРМУВАННЯ ЗАВДАННЯ ДЛЯ GEMINI
// ======================================================

function makePrompt(data) {
  const subject = cleanInput(data.subject, 'Не зазначено', 200);
  const grade = cleanInput(data.grade, 'Не зазначено', 100);
  const topic = cleanInput(data.topic, 'Не зазначено', 1000);
  const type = cleanInput(data.type, 'Комбінований урок', 200);
  const extra = cleanInput(data.extra, 'Немає', 3000);
  const duration = cleanInput(data.duration, '45 хвилин', 50);

  return `
Ти — досвідчений український педагог спеціальної школи
та педагог-дефектолог.

Створи повний, конкретний і методично грамотний
план-конспект уроку для учнів з легкими
інтелектуальними порушеннями.

ВХІДНІ ДАНІ:
Предмет: ${subject}
Клас: ${grade}
Тема: ${topic}
Тип уроку: ${type}
Тривалість: ${duration}
Додаткові побажання: ${extra}

ЗАГАЛЬНІ ВИМОГИ:
1. Пиши виключно українською мовою.
2. Враховуй вік, клас і навчальні можливості учнів.
3. Адаптуй матеріал саме до вказаного предмета й теми.
4. Використовуй короткі, зрозумілі речення та прості інструкції.
5. Передбачай показ зразка, наочність, картки, схеми
   або предмети, якщо вони доречні.
6. Розбивай складні завдання на невеликі послідовні кроки.
7. Передбачай повторення інструкцій, додатковий час
   і допомогу вчителя.
8. Чергуй види діяльності, додавай доступні ігрові
   та практичні вправи.
9. Передбачай диференціацію: завдання з допомогою
   та завдання для самостійного виконання.
10. Не вигадуй нормативних вимог, назв програм
    або результатів, яких не можна обґрунтувати.
11. Не пиши загальні фрази замість конкретних завдань.
    Усі вправи мають відповідати темі уроку.
12. Розподіл часу усіх етапів має разом дорівнювати
    тривалості уроку.
13. Домашнє завдання має бути посильним;
    якщо воно недоречне, так і зазнач.

СТРУКТУРА:
1. Тема уроку.
2. Мета: навчальна, розвивальна, виховна.
3. Корекційно-розвиткова спрямованість.
4. Тип уроку.
5. Обладнання та наочність.
6. Очікувані результати.
7. Хід уроку з точним розподілом часу.
8. Підсумок і рефлексія.
9. Домашнє завдання.

ДЛЯ КОЖНОГО ЕТАПУ ХОДУ УРОКУ ВКАЖИ:
- назву етапу та кількість хвилин;
- конкретні слова або запитання вчителя;
- дії вчителя;
- дії учнів;
- конкретні вправи/завдання з відповідями
  або зразками, де це доречно;
- методичні адаптації та види допомоги.

Зроби конспект достатньо докладним, щоб учитель
міг провести урок за цим матеріалом без самостійного
дописування основних завдань.

Форматуй відповідь зрозумілими заголовками,
списками й таблицями, якщо це полегшує читання.
`;
}

// ======================================================
// ПОМИЛКИ GEMINI ТА ПОВТОРНІ СПРОБИ
// ======================================================

class GeminiError extends Error {
  constructor(message, statusCode = 502, retryable = false, retryAfterMs = 0) {
    super(message);
    this.name = 'GeminiError';
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(response) {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 10000);
  }
  const dateMs = Date.parse(value) - Date.now();
  return Number.isFinite(dateMs) && dateMs > 0
    ? Math.min(dateMs, 10000)
    : 0;
}

function calculateBackoff(attempt, baseDelayMs = 1000, maxDelayMs = 16000) {
  const exponentialDelay = Math.min(
    baseDelayMs * 2 ** (attempt - 1),
    maxDelayMs
  );
  const jitter = Math.random() * 1000;
  return exponentialDelay + jitter;
}

async function requestGemini(model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Використовуємо v1beta, оскільки модель gemini-2.5-flash доступна там
  const url = `${API_BASE}${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY,
        'User-Agent': 'RozumnyiPlanKonspekt/1.0'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 8192
        }
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new GeminiError(
        `Google API повернув не JSON (HTTP ${response.status}).`,
        response.status || 502,
        response.status >= 500,
        parseRetryAfter(response)
      );
    }

    if (!response.ok) {
      const apiMessage =
        result?.error?.message || 'Невідома помилка Google API';
      const retryable = [408, 429, 500, 502, 503, 504].includes(
        response.status
      );
      throw new GeminiError(
        `Gemini HTTP ${response.status}: ${apiMessage}`,
        response.status,
        retryable,
        parseRetryAfter(response)
      );
    }

    const candidate = result?.candidates?.[0];
    const answer = candidate?.content?.parts
      ?.map(part => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();

    if (answer) return answer;

    const finish = candidate?.finishReason;
    const blockReason =
      result?.promptFeedback?.blockReason ||
      (finish && finish !== 'STOP' ? finish : 'порожня відповідь');

    throw new GeminiError(
      `Gemini не повернув текст. Причина: ${blockReason}. ` +
        `Спробуйте змінити тему або формулювання.`,
      422,
      false
    );
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new GeminiError(
        `Час очікування відповіді моделі ${model} вичерпано.`,
        504,
        true
      );
    }
    if (error instanceof GeminiError) throw error;
    throw new GeminiError(
      `Не вдалося з'єднатися з Google Gemini: ${error.message}`,
      503,
      true
    );
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(prompt) {
  if (!API_KEY) {
    throw new GeminiError(
      'Не налаштовано GEMINI_API_KEY. Додайте його у змінні середовища.',
      500,
      false
    );
  }
  if (typeof fetch !== 'function') {
    throw new GeminiError(
      'Потрібен Node.js версії 18 або новішої.',
      500,
      false
    );
  }

  const models = [
    { name: MODEL, attempts: MAX_ATTEMPTS_PRIMARY },
    ...(FALLBACK_MODEL && FALLBACK_MODEL !== MODEL
      ? [{ name: FALLBACK_MODEL, attempts: MAX_ATTEMPTS_FALLBACK }]
      : []),
    ...(EMERGENCY_MODEL &&
    EMERGENCY_MODEL !== MODEL &&
    EMERGENCY_MODEL !== FALLBACK_MODEL
      ? [{ name: EMERGENCY_MODEL, attempts: MAX_ATTEMPTS_EMERGENCY }]
      : [])
  ];

  let lastError = null;

  for (const modelConfig of models) {
    for (let attempt = 1; attempt <= modelConfig.attempts; attempt++) {
      try {
        console.log(
          `[GEMINI] Модель ${modelConfig.name}; ` +
            `спроба ${attempt}/${modelConfig.attempts}`
        );
        const answer = await requestGemini(modelConfig.name, prompt);
        console.log(`[GEMINI SUCCESS] ${modelConfig.name}`);
        return answer;
      } catch (error) {
        lastError = error;
        console.error(
          `[GEMINI ERROR] ${modelConfig.name}: ${error.message}`
        );

        // 404 — модель не знайдена або недоступна: переходимо до наступної
        if (error.statusCode === 404) break;

        if (!error.retryable) throw error;

        if (attempt < modelConfig.attempts) {
          const backoff = calculateBackoff(attempt);
          const delay = Math.max(backoff, error.retryAfterMs || 0);
          console.log(`[GEMINI RETRY] Очікування ${Math.round(delay)} мс`);
          await sleep(delay);
        }
      }
    }
    console.log(
      `[GEMINI FALLBACK] Перемикаємось з ${modelConfig.name} ` +
        `на наступну модель...`
    );
  }

  throw new GeminiError(
    `Зараз Google Gemini тимчасово не відповідає. ` +
      `Спробуйте ще раз через хвилину. ` +
      `Остання помилка: ${lastError?.message || 'невідома помилка'}`,
    lastError?.statusCode === 429 ? 429 : 503,
    true
  );
}

// ======================================================
// СТАТИЧНІ ФАЙЛИ САЙТУ
// ======================================================

function serveStatic(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { error: 'Некоректний шлях до файлу.' });
  }

  const relativePath =
    decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  const relative = path.relative(PUBLIC_DIR, filePath);

  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    return sendJson(res, 403, { error: 'Доступ заборонено.' });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      console.error('[STATIC FILE NOT FOUND]', relativePath);
      return sendJson(res, 404, { error: 'Файл не знайдено.' });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    res.end(content);
  });
}

// ======================================================
// HTTP-СЕРВЕР
// ======================================================

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );
    const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';

    // ---- Перевірка стану сервера ----
    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      normalizedPath === '/health'
    ) {
      return sendJson(res, 200, {
        ok: true,
        app: 'rozumnyi-plan-konspekt',
        model: MODEL,
        fallbackModel: FALLBACK_MODEL,
        emergencyModel: EMERGENCY_MODEL,
        apiKeyConfigured: Boolean(API_KEY),
        nodeVersion: process.version
      });
    }

    // ---- Генерація плану-конспекту ----
    if (req.method === 'POST' && normalizedPath === '/api/generate') {
      let data;
      try {
        data = await readRequest(req);
      } catch (error) {
        return sendJson(res, error.statusCode || 400, {
          success: false,
          error: error.message
        });
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Передайте коректні дані уроку.'
        });
      }
      if (
        !String(data.subject || '').trim() ||
        !String(data.topic || '').trim()
      ) {
        return sendJson(res, 400, {
          success: false,
          error: 'Вкажіть навчальний предмет і тему уроку.'
        });
      }

      try {
        const prompt = makePrompt(data);
        const answer = await callGemini(prompt);
        return sendJson(res, 200, {
          success: true,
          response: answer
        });
      } catch (error) {
        const status = error.statusCode || 502;
        console.error('[GENERATION FAILED]', error.message);
        const headers =
          status === 429 || status === 503
            ? { 'Retry-After': '60' }
            : {};
        return sendJson(
          res,
          status,
          {
            success: false,
            error:
              status === 429 || status === 503
                ? 'Сервіс Gemini тимчасово перевантажений. ' +
                  'Спробуйте ще раз через хвилину.'
                : 'Не вдалося створити план-конспект.',
            details: error.message
          },
          headers
        );
      }
    }

    // ---- Статичні файли ----
    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, url.pathname);
    }

    return sendJson(
      res,
      405,
      { success: false, error: 'Метод не підтримується.' },
      { Allow: 'GET, HEAD, POST' }
    );
  } catch (error) {
    console.error('[SERVER ERROR]', error);
    return sendJson(res, 500, {
      success: false,
      error: 'Внутрішня помилка сервера.'
    });
  }
});

// ======================================================
// ЗАПУСК СЕРВЕРА
// ======================================================

server.requestTimeout = 90000;
server.headersTimeout = 60000;
server.keepAliveTimeout = 5000;

server.listen(PORT, '0.0.0.0', () => {
  const actualPort = server.address().port;
  console.log('========================================');
  console.log('РОЗУМНИЙ ПЛАН-КОНСПЕКТ');
  console.log('Сервер успішно запущено');
  console.log('Порт:', actualPort);
  console.log('Node.js:', process.version);
  console.log('Основна модель Gemini:', MODEL);
  console.log('Резервна модель Gemini:', FALLBACK_MODEL);
  console.log('Аварійна модель Gemini:', EMERGENCY_MODEL);
  console.log('API ключ:', API_KEY ? 'Налаштований' : 'ВІДСУТНІЙ');
  console.log('Папка сайту:', PUBLIC_DIR);
  console.log('========================================');
});

server.on('error', error => {
  console.error('[SERVER START ERROR]', error);
  process.exit(1);
});

// ======================================================
// ГРАЦІОЗНЕ ЗАВЕРШЕННЯ
// ======================================================

process.on('unhandledRejection', reason => {
  console.error('[UNHANDLED REJECTION]', reason);
});

function shutdown(signal) {
  console.log(`[SHUTDOWN] Отримано ${signal}, закриваю сервер...`);
  server.close(() => {
    console.log('[SHUTDOWN] Сервер закрито.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
