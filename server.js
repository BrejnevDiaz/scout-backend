const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.ANTHROPIC_API_KEY;

const SCOUT_PROMPT_WEB = `Expert marché e-commerce italien. Utilise la recherche web pour trouver des marques italiennes émergentes RÉELLES dans la niche donnée. E-commerce actif, présence Instagram/TikTok, fondée après 2018. JSON uniquement: {"marques":[{"nome":"...","sito":"...","instagram":"...","descrizione":"...","segnali":"...","score":8}]}`;

const SCOUT_PROMPT_MEMORY = `Expert marché e-commerce italien 2018-2024. Génère des marques italiennes émergentes réelles ou très plausibles dans la niche donnée. Sois SPÉCIFIQUE: produits précis, noms réels, sites plausibles (.it ou .com). JSON uniquement sans markdown: {"marques":[{"nome":"...","sito":"...","instagram":"...","descrizione":"...","segnali":"...","score":8}]}`;

const EMAIL_PROMPT_WEB = `Agente prospection Viral Acquisition, agenzia influencer marketing italiana. Modello: 100% performance, zero costi anticipati. Cerca info reali sul brand via web search e genera JSON: {"analisi":"...","oggetto":"...","email":"(italiana max 120 parole, firma Diaz|Viral Acquisition|viralacquisition@gmail.com, no commissioni, zero rischio)","score":8,"score_note":"..."}`;

const EMAIL_PROMPT_MEMORY = `Agente prospection Viral Acquisition, agenzia influencer marketing italiana. Modello: 100% performance, zero costi anticipati. Basandoti sulle info fornite genera JSON: {"analisi":"(3 righe specifiche sul brand)","oggetto":"(oggetto email accattivante)","email":"(italiana max 120 parole, personalizzata, firma Diaz|Viral Acquisition|viralacquisition@gmail.com, no commissioni, zero rischio finanziario)","score":8,"score_note":"(giustificazione specifica)"}`;

async function callClaudeWeb(systemPrompt, userMessage) {
  const messages = [{ role: "user", content: userMessage }];
  let finalText = "";
  let iterations = 0;
  while (iterations < 8) {
    iterations++;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages,
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const content = data.content || [];
    const textBlocks = content.filter((b) => b.type === "text");
    if (textBlocks.length > 0) finalText = textBlocks.map((b) => b.text || "").join("").trim();
    if (data.stop_reason === "end_turn") break;
    const toolUseBlocks = content.filter((b) => b.type === "tool_use");
    if (toolUseBlocks.length === 0) break;
    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: toolUseBlocks.map((tu) => ({ type: "tool_result", tool_use_id: tu.id, content: Array.isArray(tu.content) ? tu.content : [{ type: "text", text: String(tu.content || "done") }] })) });
  }
  return finalText;
}

async function callClaudeMemory(systemPrompt, userMessage) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
}

function parseJSON(raw) {
  const clean = raw.replace(/```json|```|`/g, "").trim();
  try { return JSON.parse(clean); }
  catch { const m = clean.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
}

app.get("/", (req, res) => res.json({ status: "ok", message: "Scout Backend v2 · Viral Acquisition" }));

app.post("/scout", async (req, res) => {
  try {
    const { niche, size, count, mode } = req.body;
    if (!niche) return res.status(400).json({ error: "niche required" });
    const useWeb = mode === "web";
    const prompt = useWeb ? SCOUT_PROMPT_WEB : SCOUT_PROMPT_MEMORY;
    const userMsg = `Trova ${count || 8} brand italiani emergenti nella niche "${niche}". Dimensione target: ${size || "5k-50k followers"}.`;
    const raw = useWeb ? await callClaudeWeb(prompt, userMsg) : await callClaudeMemory(prompt, userMsg);
    const parsed = parseJSON(raw) || { marques: [] };
    res.json({ ...parsed, mode: useWeb ? "web" : "memory" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/email", async (req, res) => {
  try {
    const { nome, sito, instagram, descrizione, niche, mode } = req.body;
    if (!nome) return res.status(400).json({ error: "nome required" });
    const useWeb = mode === "web";
    const prompt = useWeb ? EMAIL_PROMPT_WEB : EMAIL_PROMPT_MEMORY;
    const userMsg = `Brand: ${nome}\nSito: ${sito || "N/A"}\nInstagram: ${instagram ? "@" + instagram : "N/A"}\nDescrizione: ${descrizione || ""}\nNiche: ${niche || "beauty"}`;
    const raw = useWeb ? await callClaudeWeb(prompt, userMsg) : await callClaudeMemory(prompt, userMsg);
    const parsed = parseJSON(raw);
    if (!parsed) throw new Error("Parsing failed");
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Scout Backend v2 running on port ${PORT}`));
