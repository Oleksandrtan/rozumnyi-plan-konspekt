const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const IKEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gemini-1.5-flash';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && u.pathname === '/health') {
      return sendJson(res, 200, { ok: true, app: 'rozumnyi-plan-konspekt' });
    }

    if (req.method === 'POST' && u.pathname === '/api/generate') {
      if (!IKEY) {
        return sendJson(res, 500, { error: 'Не налаштовано OPENAI_API_KEY.' });
      }

      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1000000) {
          return sendJson(res, 413, { error: 'Занадто великий запит' });
        }
      }

      let data;
      try {
        data = JSON.parse(body || '{}');
      } catch {
        return sendJson(res, 400, { error: 'Некоректний JSON' });
      }

      const sub = data.subject || 'Без предмета';
      const cls = data.grade || '1 клас';
      const topic = data.topic || 'Без теми';
      const type = data.type || 'Загальний урок';
      const wishes = data.extra || 'Немає';

      const prompt = `АУДИТОРІЯ: ${cls} з легким розумовим відставанням (легкими інтелектуальними порушеннями).
ПРЕДМЕТ: ${sub}
ТЕМА: ${topic}
ТИП УРОКУ: ${type}
ПОБАЖАННЯ ТА ОСОБЛИВОСТІ: ${wishes}

Склади детальний, але простий план-конспект уроку з адаптацією для цих дітей. Використовуй короткі речення, яскраві приклади, ігрові моменти та візуальні підказки.`;

      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }]
      };

      const apiReq = https.request(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${IKEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        },
        (apiRes) => {
          let apiData = '';
          apiRes.on('data', (chunk) => { apiData += chunk; });
          apiRes.on('end', () => {
            try {
              const parsed = JSON.parse(apiData);
              if (parsed.candidates && parsed.candidates[0]?.content?.parts?.[0]?.text) {
                const text = parsed.candidates[0].content.parts[0].text;
                return sendJson(res, 200, { response: text });
              } else {
                return sendJson(res, 500, { error: 'Помилка API', Details: parsed });
              }
            } catch {
              return sendJson(res, 500, { error: 'Помилка парсингу відповіді' });
            }
          });
        }
      );

      apiReq.on('error', (err) => {
        return sendJson(res, 500, { error: 'Помилка запиту до AI', details: err.message });
      });

      apiReq.write(JSON.stringify(requestBody));
      apiReq.end();
      return;
    }

    const uriPath = decodeURIComponent(u.pathname);
    let relUrl = uriPath === '/' ? 'index.html' : uriPath.replace(/^\/+/, '');
    let filePath = path.join(PUBLIC_DIR, relUrl);

    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not Found');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(content);
    });

  } catch (err) {
    console.error('Server error', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Внутрішня помилка сервера' });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
