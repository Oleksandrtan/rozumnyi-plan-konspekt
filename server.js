
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ======================================================
// НАЛАШТУВАННЯ
// ======================================================

const PORT = Number(process.env.PORT) || 10000;

const API_KEY = String(
  process.env.GEMINI_API_KEY || ''
).trim();

const MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';

const EMERGENCY_MODEL =
  process.env.GEMINI_EMERGENCY_MODEL || 'gemini-3.1-pro-preview';

const API_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models/';

const MODELS_LIST_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

const PUBLIC_DIR = path.join(__dirname, 'public');

const REQUEST_TIMEOUT_MS = 90000;
const MAX_REQUEST_SIZE = 1000000;

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
  if (res.headersSent || res.writableEnded || res.destroyed) {
    return;
  }

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
      const error = new Error(
        'Занадто великий запит. Максимум 1 МБ.'
      );

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
// ОТРИМАННЯ ДОСТУПНИХ МОДЕЛЕЙ GEMINI
// ======================================================

async function fetchAvailableModels() {
  if (!API_KEY) return null;

  try {
    const response = await fetch(MODELS_LIST_URL, {
      method: 'GET',
      headers: {
        'x-goog-api-key': API_KEY
      }
    });

    if (!response.ok) {
      console.warn(
        `[MODELS] Список моделей недоступний: HTTP ${response.status}`
      );

      return null;
    }

    const data = await response.json();

    const models = (data.models || [])
      .filter(model =>
        model.supportedGenerationMethods?.includes('generateContent')
      )
      .map(model =>
        model.name.replace(/^models\//, '')
      );

    return models.length ? models : null;

  } catch (error) {
    console.warn(
      '[MODELS] Помилка отримання моделей:',
      error.message
    );

    return null;
  }
}

function buildModelList(dynamicModels) {
  const preferred = [
    MODEL,
    FALLBACK_MODEL,
    EMERGENCY_MODEL
  ].filter(Boolean);

  if (Array.isArray(dynamicModels) && dynamicModels.length) {
    const available = new Set(dynamicModels);

    const selected = preferred.filter(model =>
      available.has(model)
    );

    if (selected.length) {
      return [...new Set(selected)];
    }

    console.warn(
      '[MODELS] Налаштовані моделі недоступні. ' +
      'Використовується перша доступна модель.'
    );

    return [dynamicModels[0]];
  }

  return [...new Set(preferred)];
}

// ======================================================
// ФОРМУВАННЯ ПРОМПТУ
// ======================================================

function makePrompt(data) {
  const subject = cleanInput(
    data.subject,
    'Не зазначено',
    200
  );

  const grade = cleanInput(
    data.grade,
    'Не зазначено',
    100
  );

  const topic = cleanInput(
    data.topic,
    'Не зазначено',
    1000
  );

  const type = cleanInput(
    data.type,
    'Комбінований урок',
    200
  );

  const extra = cleanInput(
    data.extra,
    'Немає',
    3000
  );

  const duration = cleanInput(
    data.duration,
    '45 хвилин',
    50
  );

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
3. Адаптуй матеріал до вказаного предмета й теми.
4. Використовуй короткі, зрозумілі речення.
5. Передбачай показ зразка, наочність, картки та схеми.
6. Розбивай складні завдання на невеликі кроки.
7. Передбачай повторення інструкцій і допомогу вчителя.
8. Чергуй види діяльності.
9. Додавай доступні ігрові та практичні вправи.
10. Передбачай завдання з допомогою та самостійно.
11. Не використовуй загальні фрази замість конкретних завдань.
12. Усі вправи повинні відповідати темі уроку.
13. Розподіл часу має відповідати тривалості уроку.
14. Домашнє завдання має бути посильним.

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

ДЛЯ КОЖНОГО ЕТАПУ ВКАЖИ:

- Назву етапу та кількість хвилин.
- Конкретні слова та запитання вчителя.
- Дії вчителя.
- Дії учнів.
- Конкретні вправи та завдання.
- Відповіді або зразки виконання, де це доречно.
- Методичні адаптації та види допомоги.

Зроби конспект достатньо докладним, щоб учитель
міг провести урок без самостійного дописування
основних завдань.

Форматуй відповідь зрозумілими заголовками,
списками й таблицями.
`;
}

// ======================================================
// КЛАС ПОМИЛОК GEMINI
// ======================================================

class GeminiError extends Error {
  constructor(
    message,
    statusCode = 502,
    retryable = false,
    retryAfterMs = 0
  ) {
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

  return 0;
}

function calculateBackoff(attempt) {
  return Math.min(
    1000 * 2 ** (attempt - 1),
    16000
  ) + Math.random() * 1000;
}

// ======================================================
// ВИТЯГУВАННЯ ТЕКСТУ З ВІДПОВІДІ GEMINI
// ======================================================

function extractGeminiText(result) {
  if (!result || typeof result !== 'object') {
    return '';
  }

  // Стандартний формат Gemini generateContent
  const candidates = result.candidates || [];

  const texts = [];

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];

    for (const part of parts) {
      if (typeof part.text === 'string') {
        texts.push(part.text);
      }
    }
  }

  const answer = texts.join('\n').trim();

  if (answer) return answer;

  // Додаткові варіанти структури відповіді
  if (typeof result.text === 'string') {
    return result.text.trim();
  }

  if (typeof result.output_text === 'string') {
    return result.output_text.trim();
  }

  return '';
}

// ======================================================
// ЗАПИТ ДО GEMINI
// ======================================================

async function requestGemini(model, prompt) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  const url =
    `${API_BASE}${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await fetch(url, {
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
        `Google API повернув некоректну відповідь. HTTP ${response.status}`,
        response.status || 502,
        response.status >= 500
      );
    }

    if (!response.ok) {
      const message =
        result?.error?.message ||
        'Невідома помилка Google API';

      const retryable = [
        408,
        429,
        500,
        502,
        503,
        504
      ].includes(response.status);

      throw new GeminiError(
        `Gemini HTTP ${response.status}: ${message}`,
        response.status,
        retryable,
        parseRetryAfter(response)
      );
    }

    const answer = extractGeminiText(result);

    if (!answer) {
      const candidate = result?.candidates?.[0];

      const reason =
        result?.promptFeedback?.blockReason ||
        candidate?.finishReason ||
        'Gemini повернув порожню відповідь';

      console.error(
        '[GEMINI EMPTY RESPONSE]',
        JSON.stringify({
          promptFeedback: result?.promptFeedback,
          finishReason: candidate?.finishReason,
          candidateCount: result?.candidates?.length
        })
      );

      throw new GeminiError(
        `Gemini не повернув текст. Причина: ${reason}`,
        502,
        true
      );
    }

    return answer;

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new GeminiError(
        `Час очікування моделі ${model} вичерпано.`,
        504,
        true
      );
    }

    if (error instanceof GeminiError) {
      throw error;
    }

    throw new GeminiError(
      `Помилка з'єднання з Gemini: ${error.message}`,
      503,
      true
    );

  } finally {
    clearTimeout(timer);
  }
}

// ======================================================
// ГЕНЕРАЦІЯ З РЕЗЕРВНИМИ МОДЕЛЯМИ
// ======================================================

async function callGemini(prompt) {
  if (!API_KEY) {
    throw new GeminiError(
      'Не налаштовано GEMINI_API_KEY у Render.',
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

  const availableModels = await fetchAvailableModels();

  const models = buildModelList(availableModels);

  let lastError = null;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];

    const attempts = modelIndex === 0 ? 3 : 2;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        console.log(
          `[GEMINI] Модель ${model}; спроба ${attempt}/${attempts}`
        );

        const answer = await requestGemini(
          model,
          prompt
        );

        console.log(
          `[GEMINI SUCCESS] ${model}; довжина тексту: ${answer.length}`
        );

        return answer;

      } catch (error) {
        lastError = error;

        console.error(
          `[GEMINI ERROR] ${model}: ${error.message}`
        );

        if (error.statusCode === 404) {
          break;
        }

        if (!error.retryable) {
          throw error;
        }

        if (attempt < attempts) {
          const delay = Math.max(
            calculateBackoff(attempt),
            error.retryAfterMs || 0
          );

          console.log(
            `[GEMINI RETRY] Очікування ${Math.round(delay)} мс`
          );

          await sleep(delay);
        }
      }
    }

    console.log(
      `[GEMINI FALLBACK] Перехід до наступної моделі`
    );
  }

  throw new GeminiError(
    lastError?.message ||
      'Усі моделі Gemini тимчасово недоступні.',
    lastError?.statusCode || 503,
    true
  );
}

// ======================================================
// ВІДПРАВЛЕННЯ УСПІШНОЇ ВІДПОВІДІ
// ======================================================

function sendGeneratedText(res, answer) {
  const text = String(answer || '').trim();

  if (!text) {
    return sendJson(res, 502, {
      success: false,
      error: 'Gemini не повернув текст.',
      details: 'Отримана порожня відповідь.'
    });
  }

  console.log(
    `[RESPONSE] Відправлено текст. Символів: ${text.length}`
  );

  return sendJson(res, 200, {
    success: true,
    response: text,
    text: text,
    answer: text,
    result: text,
    content: text
  });
}

// ======================================================
// СТАТИЧНІ ФАЙЛИ
// ======================================================

function serveStatic(req, res, pathname) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, {
      error: 'Некоректний шлях до файлу.'
    });
  }

  const relativePath =
    decodedPath === '/'
      ? 'index.html'
      : decodedPath.replace(/^\/+/, '');

  const filePath = path.resolve(
    PUBLIC_DIR,
    relativePath
  );

  const relative = path.relative(
    PUBLIC_DIR,
    filePath
  );

  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    return sendJson(res, 403, {
      error: 'Доступ заборонено.'
    });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      console.warn(
        '[STATIC FILE NOT FOUND]',
        relativePath
      );

      return sendJson(res, 404, {
        error: 'Файл не знайдено.'
      });
    }

    const ext = path.extname(filePath).toLowerCase();

    res.writeHead(200, {
      'Content-Type':
        MIME[ext] || 'application/octet-stream',

      'Content-Length': content.length,

      'Cache-Control':
        ext === '.html'
          ? 'no-cache'
          : 'public, max-age=3600',

      'X-Content-Type-Options': 'nosniff'
    });

    if (req.method === 'HEAD') {
      return res.end();
    }

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

    const pathname =
      url.pathname.replace(/\/+$/, '') || '/';

    // Перевірка сервера
    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      pathname === '/health'
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

    // Генерація плану-конспекту
    if (
      req.method === 'POST' &&
      pathname === '/api/generate'
    ) {
      let data;

      try {
        data = await readRequest(req);
      } catch (error) {
        return sendJson(
          res,
          error.statusCode || 400,
          {
            success: false,
            error: error.message
          }
        );
      }

      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data)
      ) {
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
          error: 'Вкажіть предмет і тему уроку.'
        });
      }

      try {
        const prompt = makePrompt(data);

        const answer = await callGemini(prompt);

        return sendGeneratedText(res, answer);

      } catch (error) {
        const status = error.statusCode || 502;

        console.error(
          '[GENERATION FAILED]',
          error.message
        );

        return sendJson(
          res,
          status,
          {
            success: false,
            error: error.message,
            details: error.message
          },
          status === 429 || status === 503
            ? { 'Retry-After': '60' }
            : {}
        );
      }
    }

    // Статичні файли
    if (
      req.method === 'GET' ||
      req.method === 'HEAD'
    ) {
      return serveStatic(
        req,
        res,
        url.pathname
      );
    }

    return sendJson(res, 405, {
      success: false,
      error: 'Метод не підтримується.'
    });

  } catch (error) {
    console.error('[SERVER ERROR]', error);

    return sendJson(res, 500, {
      success: false,
      error: 'Внутрішня помилка сервера.',
      details: error.message
    });
  }
});

// ======================================================
// ЗАПУСК СЕРВЕРА
// ======================================================

server.requestTimeout = 120000;
server.headersTimeout = 60000;
server.keepAliveTimeout = 5000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('РОЗУМНИЙ ПЛАН-КОНСПЕКТ');
  console.log('Сервер успішно запущено');
  console.log('Порт:', PORT);
  console.log('Node.js:', process.version);
  console.log('Основна модель:', MODEL);
  console.log('Резервна модель:', FALLBACK_MODEL);
  console.log('Аварійна модель:', EMERGENCY_MODEL);

  console.log(
    'API ключ:',
    API_KEY ? 'Налаштований' : 'ВІДСУТНІЙ'
  );

  console.log('Папка сайту:', PUBLIC_DIR);
  console.log('========================================');
});

server.on('error', error => {
  console.error('[SERVER START ERROR]', error);
  process.exit(1);
});

// ======================================================
// ЗАВЕРШЕННЯ СЕРВЕРА
// ======================================================

process.on('unhandledRejection', reason => {
  console.error('[UNHANDLED REJECTION]', reason);
});

function shutdown(signal) {
  console.log(
    `[SHUTDOWN] Отримано ${signal}, закриваю сервер...`
  );

  server.close(() => {
    console.log('[SHUTDOWN] Сервер закрито.');
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
