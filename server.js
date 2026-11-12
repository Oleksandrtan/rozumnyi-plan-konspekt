const http=require("http"),fs=require("fs"),path=require("path");
const ROOT=path.join(__dirname,"public"),PORT=Number(process.env.PORT||3000);
const KEY=process.env.OPENAI_API_KEY,MODEL=process.env.OPENAI_MODEL||"gpt-6-astra";
function send(res,status,obj){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(obj))}
function body(req){return new Promise((resolve,reject)=>{let s="";req.on("data",c=>{s+=c;if(s.length>20000){reject(Error("Завеликий запит"));req.destroy()}});req.on("end",()=>{try{resolve(JSON.parse(s||"{}"))}catch{reject(Error("Некоректний формат запиту"))}});req.on("error",reject)})}
server.on('request', (req, res) => { if (req.url === '/') { res.writeHead(200, {'Content-Type': 'text/html'}); require('fs').createReadStream(require('path').join(__dirname, 'public', 'index.html')).pipe(res); } });.
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,"http://localhost");
 if(req.method==="GET" && u.pathname==="/health") {res.writeHead(200,{"Content-Type":"application/json"});return res.end(JSON.stringify({ok:true,app:"rozumnyi-plan-konspekt"}));}
 if(req.method==="POST"&&u.pathname==="/api/generate"){
  if(!KEY)return send(res,503,{error:"На сервері не налаштовано OPENAI_API_KEY. Перегляньте README."});
  try{
   const d=await body(req),subject=String(d.subject||"").slice(0,150),grade=String(d.grade||"").slice(0,60),topic=String(d.topic||"").slice(0,300);
   if(!subject||!grade||!topic)return send(res,400,{error:"Вкажіть предмет, клас і тему."});
   const duration=String(d.duration||"45 хвилин"),type=String(d.lessonType||"Визначити автоматично"),extra=String(d.extra||"").slice(0,1000);
   const input=`Ти — досвідчений український учитель-методист спеціальної школи. Склади повний практичний план-конспект українською.
ВХІДНІ ДАНІ:
Предмет: ${subject}
Клас: ${grade}
Тема: ${topic}
Тривалість: ${duration}
Тип уроку: ${type}
Побажання: ${extra||"немає"}.

АУДИТОРІЯ: учні з легкою розумовою відсталістю (легкими інтелектуальними порушеннями). Не змінюй предмет, клас чи тему. Адаптуй зміст саме введеного предмета до можливостей учнів. Не припускай конкретних індивідуальних діагнозів.

ЗМІСТ:
- Тема, мета (навчальна, розвивальна, виховна), корекційно-розвиткова спрямованість, тип, обладнання, очікувані результати.
- Хід уроку у таблиці: етап і час; діяльність учителя; діяльність учнів; методичні вказівки та адаптація.
- Розподіл часу має дорівнювати точно ${duration}.
- Дай конкретні завдання з прикладами саме за темою, запитання й репліки вчителя, очікувані відповіді.
- Інструкції короткі, покрокові; передбач повторення, наочність, показ зразка, часту зміну діяльності, позитивне підкріплення, перевірку розуміння.
- Диференціація: базовий рівень, додаткова підтримка, за доречності — завдання складнішого рівня.
- Практична робота/картки/схеми/предметна наочність; рухова пауза лише якщо доречна предмету.
- Домашнє завдання коротке, реалістичне, з чіткою інструкцією.
- Заверш коротким самоаналізом учителя з 2–3 запитаннями.

Не вигадуй нормативних документів, цитат, медичних рекомендацій або фактів про конкретних учнів. Пиши конкретно, професійно, без загальних шаблонних фраз. Використовуй заголовки та читабельну таблицю.`;
   const api=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":"Bearer "+KEY,"Content-Type":"application/json"},body:JSON.stringify({model:MODEL,input,store:false})});
   const out=await api.json();if(!api.ok)return send(res,api.status,{error:out.error?.message||"Помилка API генерації."});
   let text=out.output_text;if(!text&&Array.isArray(out.output))text=out.output.flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("\n");
   if(!text)return send(res,502,{error:"Модель не повернула текст конспекту."});return send(res,200,{text});
  }catch(e){return send(res,500,{error:e.message||"Внутрішня помилка сервера"})}
 }
 if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405);return res.end("Method not allowed")}
 const pathname=decodeURIComponent(u.pathname==="/"?"/index.html":u.pathname),file=path.normalize(path.join(ROOT,pathname));
 if(!file.startsWith(ROOT)){res.writeHead(403);return res.end("Forbidden")}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end("Not found")}const ext=path.extname(file),types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".webmanifest":"application/manifest+json",".svg":"image/svg+xml"};res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","X-Content-Type-Options":"nosniff"});res.end(req.method==="HEAD"?undefined:data)});
});
server.listen(PORT,"0.0.0.0",()=>console.log("Розумний план-конспект: http://localhost:"+PORT));
