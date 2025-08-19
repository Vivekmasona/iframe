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
  let captureEnabled = false; // 👈 initially off

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
      if (!captureEnabled) return; // ignore until enabled
      const log = {
        type: "request",
        method: req.method(),
        url: req.url(),
        postData: req.postData() || null,
      };
      logs.push(log);
      ws.send(JSON.stringify(log, null, 2));
    });

    // Capture Responses
    page.on("response", async (res) => {
      if (!captureEnabled) return; // ignore until enabled
      try {
        const log = {
          type: "response",
          url: res.url(),
          status: res.status(),
        };
        logs.push(log);
        ws.send(JSON.stringify(log, null, 2));
      } catch {}
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    // handle frontend messages
    ws.on("message", async (msg) => {
      const command = msg.toString();

      if (command === "getLogs") {
        ws.send(JSON.stringify({ type: "allLogs", logs }));
      }

      if (command === "startCapture") {
        captureEnabled = true;
        logs = []; // reset logs fresh for capture
        ws.send(JSON.stringify({ type: "info", message: "▶️ Capture started" }));
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
