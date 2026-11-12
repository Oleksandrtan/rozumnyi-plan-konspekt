const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const IKEY = process.env.OPENAI_API_KEY;
const MODEL = 'gpt-4o-mini';

const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && u.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, app: 'rozumnyi-plan-konspekt' }));
        return;
    }

    if (req.method === 'POST' && u.pathname === '/api/generate') {
        if (!IKEY) {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end("Не налаштовано OPENAI_API_KEY. Перевірте README.");
            return;
        }

        let body = '';
        for await (const chunk of req) {
            body += chunk;
        }

        try {
            const data = JSON.parse(body || '{}');
            const sub = data.subject || "Без предмета";
            const cls = data.grade || "1 клас";
            const topic = data.topic || "Без теми";
            const type = data.type || "Загальний урок";
            const wishes = data.extra || "Немає";

            const prompt = `АУДИТОРІЯ: ${cls} з легкою розумовою відсталістю (легкими інтелектуальними порушеннями)
ПРЕДМЕТ: ${sub}
ТЕМА: ${topic}
ТИП УРОКУ: ${type}
ПОБАЖАННЯ: ${wishes}

Склади повний практичний план-конспект українською мовою.`;

            const response = await fetch('https://api.deepseek.com/v1/chat/completions](https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${IKEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: MODEL,
                    messages: [{ role: 'user', content: prompt }]
                })
            });

            const json = await response.json();
            const text = json.choices?.[0]?.message?.content || "Помилка від OpenAI";

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result: text }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end("Помилка сервера: " + err.message);
        }
        return;
    }

    if (req.method === 'GET') {
        let filePath = path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            } else {
                const ext = path.extname(filePath);
                const contentType = ext === '.html' ? 'text/html' : 'text/plain';
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
