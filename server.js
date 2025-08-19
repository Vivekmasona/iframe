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
  let logs = []; // store logs in memory

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Capture Requests
    page.on("request", (req) => {
      const log = {
        type: "request",
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
      };
      logs.push(log);
      ws.send(JSON.stringify(log));
    });

    // Capture Responses
    page.on("response", async (res) => {
      try {
        const log = {
          type: "response",
          url: res.url(),
          status: res.status(),
          headers: res.headers(),
        };
        logs.push(log);
        ws.send(JSON.stringify(log));
      } catch {}
    });

    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 60000 });

    // allow frontend to request full logs
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
