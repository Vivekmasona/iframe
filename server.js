import express from "express";
import { WebSocketServer } from "ws";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const app = express();
const PORT = process.env.PORT || 3000;

// serve frontend
app.use(express.static("public"));

// WebSocket server
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
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();

    // Listen requests
    page.on("request", (req) => {
      ws.send(
        JSON.stringify({
          type: "request",
          url: req.url(),
          method: req.method()
        })
      );
      console.log("➡️ Request:", req.url());
    });

    // Listen responses
    page.on("response", async (res) => {
      try {
        ws.send(
          JSON.stringify({
            type: "response",
            url: res.url(),
            status: res.status()
          })
        );
        console.log("⬅️ Response:", res.url(), res.status());
      } catch {}
    });

    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 60000 });
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

// Upgrade for WebSocket
const server = app.listen(PORT, () =>
  console.log(`✅ Server running http://localhost:${PORT}`)
);

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});
