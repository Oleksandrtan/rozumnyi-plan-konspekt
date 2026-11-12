const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const IKEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
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
        return sendJson(res, 500, {
          error: 'Не налаштовано DEEPSEEK_API_KEY (або OPENAI_API_KEY). Перевірте README.'
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

      const sub = data.subject || 'Без предмета';
      const cls = data.grade || '1 клас';
      const topic = data.topic || 'Без теми';
      const type = data.type || 'Загальний урок';
      const wishes = data.extra || 'Немає';

      const prompt = `АУДИТОРІЯ: ${cls} з легкою розумовою відсталістю (легкими інтелектуальними порушеннями)
ПРЕДМЕТ: ${sub}
ТЕМА: ${topic}
ТИП УРОКУ: ${type}
ПОБАЖАННЯ: ${wishes}

Склади детальний план-конспект уроку українською мовою.`;

      const apiRes = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + IKEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const raw = await apiRes.text();
      let result = null;
      try {
        result = JSON.parse(raw);
      } catch {
        // залишаємо result = null
      }

      if (!apiRes.ok) {
        return sendJson(res, 502, {
          error: 'Помилка DeepSeek API',
          status: apiRes.status,
          details: result?.error || raw.slice(0, 500)
        });
      }

      const text = result?.choices?.[0]?.message?.content;
      if (!text) {
        return sendJson(res, 502, {
          error: 'DeepSeek не повернув текст',
          details: result
        });
      }

      return sendJson(res, 200, { result: text });
    }

    if (req.method === 'GET') {
      const urlPath = decodeURIComponent(u.pathname);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const filePath = path.join(PUBLIC_DIR, rel);

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
          'Content-Type': MIME[ext] || 'application/octet-stream'
        });
        res.end(content);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Внутрішня помилка сервера' });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
