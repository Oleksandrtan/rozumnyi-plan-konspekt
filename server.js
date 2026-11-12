server.on('request', async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (req.method === "GET" && u.pathname === "/health") {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({"status": "ok", "service": "rozumnyi-plan-konspekt"}));
    return;
  }
  if (req.method === "POST" && u.pathname === "/api/generate") {
    if (!KEY) {
      return res.writeHead(503, {'Content-Type': 'text/plain'}).end("Не налаштовано OPENAI_API_KEY. Перевірте README.");
    }
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || "{}");
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

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const json = await response.json();
      const text = json.choices?.[0]?.message?.content || "Помилка від OpenAI";

      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ result: text }));
    } catch (err) {
      res.writeHead(500, {'Content-Type': 'text/plain'});
      res.end("Помилка сервера: " + err.message);
    }
    return;
  }
  res.writeHead(404, {'Content-Type': 'text/plain'});
  res.end("Not found");
});
