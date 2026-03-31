import express from "express";
import cors from "cors";
import axios from "axios";
import ytdl from "@distube/ytdl-core";
import puppeteer from "puppeteer";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Helper for Facebook extraction using Headless Browser
  const extractFacebookAudio = async (url: string, commonHeaders: any) => {
    console.log("Launching robust headless browser for Facebook:", url);
    
    let browser;
    try {
      const puppeteerExtra = (await import("puppeteer-extra")).default;
      const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
      puppeteerExtra.use(StealthPlugin());

      browser = await puppeteerExtra.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });

      const page = await browser.newPage();
      await page.setUserAgent(commonHeaders['User-Agent']);
      
      // Navigate to the video page
      await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

      // Try to find the video source in the rendered page
      const videoUrl = await page.evaluate(() => {
        // 1. Look for video elements
        const video = document.querySelector('video');
        if (video && video.src && !video.src.startsWith('blob:')) return video.src;

        // 2. Look into the page source for common patterns
        const html = document.documentElement.innerHTML;
        const hdMatch = html.match(/"browser_native_hd_url":"([^"]+)"/) || html.match(/hd_src:"([^"]+)"/);
        const sdMatch = html.match(/"browser_native_sd_url":"([^"]+)"/) || html.match(/sd_src:"([^"]+)"/);
        
        let foundUrl = hdMatch ? hdMatch[1] : (sdMatch ? sdMatch[1] : null);
        if (!foundUrl) {
          const mp4Match = html.match(/"(https:\/\/[^"]+?\.mp4[^"]*?)"/);
          if (mp4Match) foundUrl = mp4Match[1];
        }
        return foundUrl ? foundUrl.replace(/\\/g, '') : null;
      });

      if (!videoUrl) {
        throw new Error("Could not find video source. The video might be private, restricted to a group, or requires login.");
      }

      console.log("Found Facebook video source:", videoUrl);

      // Stream the video file
      const videoResponse = await axios.get(videoUrl, {
        responseType: "arraybuffer",
        headers: {
          ...commonHeaders,
          'Referer': 'https://www.facebook.com/',
          'Range': 'bytes=0-15728640' // 15MB limit to stay under Gemini 20MB base64 limit
        },
        timeout: 30000
      });
      
      return {
        audioData: Buffer.from(videoResponse.data).toString("base64"),
        mimeType: "audio/mp4",
        title: "Facebook Video"
      };
    } finally {
      if (browser) await browser.close();
    }
  };

  // API Endpoint to extract audio
  app.post("/api/extract-audio", async (req, res) => {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const commonHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      };

      if (ytdl.validateURL(url)) {
        console.log("Extracting audio from YouTube:", url);
        
        try {
          // Get info with custom headers to avoid 429
          const info = await ytdl.getInfo(url, {
            requestOptions: { headers: commonHeaders }
          });
          
          const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
          
          if (!format) {
            throw new Error("No suitable audio format found. This video might be restricted or have no audio track.");
          }

          const stream = ytdl(url, { 
            format,
            requestOptions: { headers: commonHeaders },
            highWaterMark: 1 << 25 // 32MB buffer
          });
          
          const chunks: Buffer[] = [];
          let totalSize = 0;
          const MAX_SIZE = 14 * 1024 * 1024; // 14MB limit (approx 15 mins audio)
          
          stream.on("data", (chunk) => {
            totalSize += chunk.length;
            if (totalSize > MAX_SIZE) {
              stream.destroy(new Error("Audio too large for direct processing. Please use a shorter video (under 15 minutes)."));
              return;
            }
            chunks.push(chunk);
          });
          
          stream.on("end", () => {
            if (totalSize === 0) {
              res.status(500).json({ error: "No audio data received. YouTube might be blocking this request or the video is unavailable." });
              return;
            }
            const buffer = Buffer.concat(chunks);
            const base64Audio = buffer.toString("base64");
            const mimeType = format.mimeType?.split(';')[0] || "audio/mp4";
            
            res.json({ 
              audioData: base64Audio, 
              mimeType: mimeType,
              title: info.videoDetails.title 
            });
          });
          
          stream.on("error", (err: any) => {
            console.error("Stream error:", err);
            const msg = err.message || "";
            if (msg.includes("Audio too large")) {
              res.status(413).json({ error: msg });
            } else {
              res.status(500).json({ error: "YouTube stream interrupted. This often happens with age-restricted or private videos." });
            }
          });
        } catch (ytError: any) {
          console.error("YouTube error:", ytError.message);
          const msg = ytError.message || "";
          
          if (msg.includes("429")) {
            res.status(429).json({ error: "YouTube is temporarily rate-limiting requests. Please try again in a few minutes." });
          } else if (msg.includes("private")) {
            res.status(403).json({ error: "This YouTube video is private. Please use a public video link." });
          } else if (msg.includes("unavailable") || msg.includes("404")) {
            res.status(404).json({ error: "YouTube video not found or unavailable. Please check the URL." });
          } else if (msg.includes("age-restricted")) {
            res.status(403).json({ error: "This video is age-restricted and cannot be accessed without a login." });
          } else {
            res.status(500).json({ error: `YouTube extraction failed: ${msg}` });
          }
        }

      } else if (url.includes("facebook.com") || url.includes("fb.watch") || url.includes("fb.com")) {
        try {
          const result = await extractFacebookAudio(url, commonHeaders);
          res.json(result);
        } catch (fetchError: any) {
          console.error("Facebook extraction error:", fetchError.message);
          if (fetchError.message.includes("timeout")) {
            res.status(504).json({ error: "Facebook request timed out. The page took too long to load." });
          } else {
            res.status(500).json({ 
              error: `Facebook extraction failed: ${fetchError.message}. Ensure the video is public and accessible without login.` 
            });
          }
        }

      } else {
        res.status(400).json({ error: "Only YouTube and Facebook URLs are supported in this MVP." });
      }
    } catch (error: any) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: error.message || "Failed to extract audio" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
