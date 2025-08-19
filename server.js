import express from "express";
import { WebSocketServer } from "ws";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", async (ws, request) => {
  const params = new URLSearchParams(request.url.replace("/?", ""));
  const targetUrl = params.get("url");

  if (!targetUrl) {
    ws.send(JSON.stringify({ error: "❌ No URL provided" }));
    ws.close();
    return;
  }

  console.log("🌍 Opening:", targetUrl);

  let browser;
  let logs = [];

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Capture Requests (only download/api related)
    page.on("request", async (req) => {
      if (
        req.method() === "POST" ||
        /download|api|convert|ajax|grab/i.test(req.url())
      ) {
        const postData = req.postData();
        const log = {
          type: "request",
          method: req.method(),
          url: req.url(),
          postData: postData || null,
          headers: req.headers(),
        };
        logs.push(log);
        ws.send(JSON.stringify(log, null, 2));
      }
    });

    // Capture Responses (filter download/media)
    page.on("response", async (res) => {
      try {
        const url = res.url();
        if (
          /download|api|convert|ajax|grab|videoplayback|\.mp4|\.mp3/i.test(url)
        ) {
          let text = null;
          try {
            text = await res.text(); // try to read body
          } catch {}
          const log = {
            type: "response",
            url,
            status: res.status(),
            headers: res.headers(),
            body: text ? text.slice(0, 500) : null, // safe preview
          };
          logs.push(log);
          ws.send(JSON.stringify(log, null, 2));
        }
      } catch {}
    });

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // allow frontend to request all logs
    ws.on("message", (msg) => {
      if (msg.toString() === "getLogs") {
        ws.send(JSON.stringify({ type: "allLogs", logs }));
      }
    });
  } catch (err) {
    console.error("❌ Error:", err.message);
    ws.send(JSON.stringify({ error: err.message }));
    ws.close();
    if (browser) await browser.close();
  }

  ws.on("close", () => {
    console.log("⚠️ WebSocket closed");
    if (browser) browser.close();
  });
});

const server = app.listen(PORT, () =>
  console.log(`✅ Server running http://localhost:${PORT}`)
);

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});
