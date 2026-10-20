const fs = require("fs");
const path = require("path");
const http = require("http");

// Setup API Key from Environment
const apiKey = process.env.GEMINI_API_KEY;

// 1. Intent Analysis
const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "as", "at",
  "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can", "code", "could",
  "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from", "further", "had", "has", "have",
  "having", "he", "her", "here", "hers", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it",
  "its", "itself", "me", "more", "most", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only",
  "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should", "so", "some", "such",
  "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they", "this",
  "those", "through", "to", "too", "under", "until", "up", "very", "was", "we", "were", "what", "when", "where",
  "which", "while", "who", "whom", "why", "with", "would", "you", "your", "yours", "yourself", "yourselves"
]);

function analyzeIntent(prompt) {
  const cleanPrompt = prompt.toLowerCase().replace(/[^\w\s]/g, " ");
  const words = cleanPrompt.split(/\s+/).filter(Boolean);
  const keywords = words.filter(w => !STOPWORDS.has(w));

  let type = "edit";
  if (cleanPrompt.includes("fix") || cleanPrompt.includes("bug") || cleanPrompt.includes("error")) type = "bugfix";
  else if (cleanPrompt.includes("optimize") || cleanPrompt.includes("speed") || cleanPrompt.includes("fast")) type = "optimize";
  else if (cleanPrompt.includes("refactor") || cleanPrompt.includes("clean")) type = "refactor";
  else if (cleanPrompt.includes("test") || cleanPrompt.includes("spec")) type = "test";
  else if (cleanPrompt.includes("document") || cleanPrompt.includes("comment")) type = "document";

  return { type, keywords: keywords.length ? keywords : words };
}

// 2. Optimized File Scanning & Scoring
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "tmp"]);
const ALLOWED_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".json", ".html", ".css", ".py", ".sh", ".md"]);

function getFiles(dir, out = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          getFiles(fullPath, out);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ALLOWED_EXTENSIONS.has(ext)) {
          out.push(fullPath);
        }
      }
    }
  } catch {
    // Fail silently on scanning errors
  }
  return out;
}

function rankFiles(dir, keywords, targetFile = null) {
  const files = getFiles(dir);
  const targetFullPath = targetFile ? path.resolve(targetFile) : null;

  return files
    .map(f => {
      const fullPath = path.resolve(f);
      if (fullPath === targetFullPath) return null; // Handle target file separately

      let score = 0;
      try {
        // Read only the first 30KB of files to score, preventing memory bloat and slow I/O
        const fd = fs.openSync(f, "r");
        const buffer = Buffer.alloc(30000);
        const bytesRead = fs.readSync(fd, buffer, 0, 30000, 0);
        fs.closeSync(fd);
        
        const content = buffer.toString("utf8", 0, bytesRead).toLowerCase();
        for (const k of keywords) {
          let pos = content.indexOf(k);
          while (pos !== -1) {
            score++;
            pos = content.indexOf(k, pos + k.length);
          }
        }
      } catch {
        // Safe fallback
      }

      return { filePath: f, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// 3. Smart Context Builder (Always ensures the Target File is included in context)
function buildContext(ranked, targetFile = null) {
  let ctx = "";

  if (targetFile && fs.existsSync(targetFile)) {
    try {
      const content = fs.readFileSync(targetFile, "utf8");
      ctx += `\n===== TARGET FILE: ${path.basename(targetFile)} (CURRENT STATE) =====\n${content}\n`;
    } catch {
      // Ignore
    }
  }

  for (const f of ranked) {
    try {
      const content = fs.readFileSync(f.filePath, "utf8");
      ctx += `\n===== REFERENCE FILE: ${path.relative(process.cwd(), f.filePath)} =====\n${content}\n`;
    } catch {
      // Ignore
    }
  }

  return ctx;
}

// 4. Robust API Request and Clean Output Handler
function cleanResponse(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // Strip Markdown triple backtick blocks (e.g. ```javascript ... ```) that LLMs output
  if (cleaned.startsWith("```")) {
    const lines = cleaned.split("\n");
    if (lines[0].startsWith("```")) lines.shift();
    if (lines[lines.length - 1].startsWith("```")) lines.pop();
    cleaned = lines.join("\n");
  }
  return cleaned.trim();
}

async function askGemini(apiKey, prompt) {
  // Use gemini-2.5-flash as default, fallback to gemini-1.5-flash
  const models = ["gemini-2.5-flash", "gemini-1.5-flash"];
  
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1 }
        })
      });

      const data = await res.json();
      if (res.ok && !data.error) {
        return cleanResponse(data?.candidates?.[0]?.content?.parts?.[0]?.text);
      }
    } catch {
      // Fallback to next model
    }
  }
  return null;
}

// 5. Processing Core Execution
async function processAiCoding(targetFile, prompt) {
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
  }

  const intent = analyzeIntent(prompt);
  const ranked = rankFiles(process.cwd(), intent.keywords, targetFile);
  const context = buildContext(ranked, targetFile);

  const finalPrompt = `
INTENT: ${intent.type}

TASK:
${prompt}

CONTEXT:
${context}

TARGET FILE:
${targetFile}

Return ONLY the complete, raw, updated code for the target file "${targetFile}".
Do not write markdown formatting block like triple backticks, explanations, comments, or intro text. Just raw code.
`;

  const result = await askGemini(apiKey, finalPrompt);
  if (!result) {
    throw new Error("Unable to obtain response from Gemini API.");
  }

  fs.writeFileSync(targetFile, result, "utf8");
  return result;
}

// 6. Dual Entry Points: CLI Mode + HTTP Server Interface
function startServer(port = process.env.PORT || 3000) {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.method === "POST" && req.url === "/api/code") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const { file, prompt } = JSON.parse(body);
          if (!file || !prompt) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: "Missing 'file' or 'prompt' parameter." }));
          }

          console.log(`📡 HTTP request to edit [${file}] with: "${prompt}"`);
          await processAiCoding(file, prompt);

          res.statusCode = 200;
          res.end(JSON.stringify({ success: true, message: `File [${file}] successfully optimized/updated.` }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Endpoint not found" }));
    }
  });

  server.listen(port, () => {
    console.log(`🤖 Optimized AI-Agent Server running on port ${port}`);
  });
}

// Command execution dispatcher
const cliFile = process.argv[2];
const cliPrompt = process.argv.slice(3).join(" ");

if (cliFile && cliPrompt) {
  (async () => {
    console.log("🚀 Running AI coder in CLI mode...");
    try {
      await processAiCoding(cliFile, cliPrompt);
      console.log("✅ File updated successfully:", cliFile);
    } catch (err) {
      console.error("❌ Error executing command:", err.message);
      process.exit(1);
    }
  })();
} else {
  // Run as HTTP Server when no arguments are provided
  startServer();
}