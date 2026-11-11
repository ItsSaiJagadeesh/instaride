// A tiny fake of Twilio's message API, used only by the tests (GPL-3.0-or-later).
//   node scripts/mock-sms.mjs   (listens on 127.0.0.1:5998)
import http from "node:http";
const log = [];
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__log") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(log)); }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const form = Object.fromEntries(new URLSearchParams(raw));
    log.push({ method: req.method, path: url.pathname, auth: req.headers.authorization, type: req.headers["content-type"], form });
    res.setHeader("Content-Type", "application/json");
    if ((form.To || "").endsWith("9999")) { res.statusCode = 500; return res.end(JSON.stringify({ message: "boom" })); }
    res.statusCode = 201;
    res.end(JSON.stringify({ sid: "SM" + log.length }));
  });
}).listen(5998, "127.0.0.1", () => console.log("mock sms on 5998"));
