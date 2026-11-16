/ ========================================
// ЗАПИТ ДО GEMINI API
// ========================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRetryDelay(response, attempt) {
  const retryAfter = response?.headers?.get('retry-after');

  if (retryAfter) {
    const seconds = Number(retryAfter);

    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 20000);
    }

    const dateDelay = Date.parse(retryAfter) - Date.now();

    if (Number.isFinite(dateDelay) && dateDelay > 0) {
      return Math.min(dateDelay, 20000);
    }
  }

  const base = Math.min(2000 * (2 ** attempt), 10000);

  return base + Math.floor(Math.random() * 700);
}

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

  const MAX_ATTEMPTS = 4;
  const RETRYABLE_STATUS = new Set([
    408, 429, 500, 502, 503, 504
  ]);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      controller.abort();
    }, TIMEOUT);

    try {
      console.log(
        `[GEMINI REQUEST] модель=${MODEL}, спроба=${attempt + 1}/${MAX_ATTEMPTS}`
      );

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
        if (
          RETRYABLE_STATUS.has(response.status) &&
          attempt < MAX_ATTEMPTS - 1
        ) {
          const delay = getRetryDelay(response, attempt);

          console.warn(
            `[GEMINI RETRY] HTTP ${response.status}; повтор через ${delay} мс`
          );

          await sleep(delay);
          continue;
        }

        throw new Error(
          `Google повернув некоректну відповідь. HTTP ${response.status}: ${raw.slice(0, 500)}`
        );
      }

      if (!response.ok) {
        const message =
          result.error?.message ||
          'Невідома помилка Google API';

        if (
          RETRYABLE_STATUS.has(response.status) &&
          attempt < MAX_ATTEMPTS - 1
        ) {
          const delay = getRetryDelay(response, attempt);

          console.warn(
            `[GEMINI RETRY] HTTP ${response.status}: ${message}. Повтор через ${delay} мс`
          );

          await sleep(delay);
          continue;
        }

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
          `Gemini не повернув текст. Причина: ${candidate.finishReason || 'невідома'}`
        );
      }

      console.log('[GEMINI SUCCESS]', MODEL);

      return answer;

    } catch (err) {
      if (err.name === 'AbortError') {
        if (attempt < MAX_ATTEMPTS - 1) {
          const delay = getRetryDelay(null, attempt);

          console.warn(
            `[GEMINI TIMEOUT] повтор через ${delay} мс`
          );

          await sleep(delay);
          continue;
        }

        throw new Error(
          'Час очікування відповіді Gemini вичерпано після кількох спроб. Спробуйте ще раз.'
        );
      }

      if (
        !String(err.message || '').startsWith('Gemini HTTP') &&
        attempt < MAX_ATTEMPTS - 1
      ) {
        const delay = getRetryDelay(null, attempt);

        console.warn(
          `[GEMINI NETWORK RETRY] ${err.message}; повтор через ${delay} мс`
        );

        await sleep(delay);
        continue;
      }

      throw err;

    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    'Gemini тимчасово недоступний. Спробуйте ще раз трохи пізніше.'
  );
}
