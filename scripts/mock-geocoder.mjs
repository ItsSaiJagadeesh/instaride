// A tiny fake of the address-search service, used only by the tests (GPL-3.0-or-later).
//   node scripts/mock-geocoder.mjs   (listens on 127.0.0.1:5999)
import http from "node:http";
let calls = 0, last = null;
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  res.setHeader("Content-Type", "application/json");
  if (u.pathname === "/__last") return res.end(JSON.stringify({ calls, last }));
  calls++;
  last = { path: u.pathname, query: Object.fromEntries(u.searchParams), ua: req.headers["user-agent"] };
  if (u.pathname === "/search") {
    return res.end(JSON.stringify([
      { display_name: "Bus Stand, Jangareddygudem, West Godavari, Andhra Pradesh, 534447, India", lat: "17.1400", lon: "81.3050" },
      { display_name: "Market Road, Jangareddygudem, West Godavari, Andhra Pradesh, India", lat: "17.1450", lon: "81.3000" },
      { display_name: "Broken Row Without Coordinates", lat: "x", lon: "y" },
    ]));
  }
  if (u.pathname === "/reverse") return res.end(JSON.stringify({ display_name: "4-5-251, Eluru Road, Jangareddygudem, Andhra Pradesh, India" }));
  res.statusCode = 404; res.end("{}");
}).listen(5999, "127.0.0.1", () => console.log("mock geocoder on 5999"));
