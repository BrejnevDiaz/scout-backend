const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.ANTHROPIC_API_KEY;

const SCOUT_PROMPT = `Expert marché e-commerce italien. Trouve des marques italiennes émergentes réelles dans la niche donnée via web search. Pour chaque marque: nom, site, instagram, description produits, signaux croissance, score fit /10. JSON uniquement: {"marques":[{"nome":"...","sito":"...","instagram":"...","descrizione":"...","segnali":"...","score":8}]}`;

const EMAIL_PROMPT = `Agente prospection Viral Acquisition, agenzia influencer marketing italiana. Modello: 100% performance, zero costi anticipati. Genera JSON: {"analisi":"...","oggetto":"...","email":"(italiana max 120 parole, firma Diaz|Viral Acquisition|viralacquisition@gmail.com, no commissioni)","score":8,"score_note":"..."}`;

async function callClaude(systemPrompt, userMessage) {
  const messages = [{ role: "user", content: userMessage }];
  let finalText = "";
  let iterations = 0;
  while (iterations < 8) {
    iterations++;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
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
    messages.push({
      role: "user",
      content: toolUseBlocks.map((tu) => ({
        type: "tool_result",
        tool_use_id: tu.id,
        content: Array.isArray(tu.content) ? tu.content : [{ type: "text", text: String(tu.content || "done") }],
      })),
    });
  }
  return finalText;
}

app.get("/", (req, res) => res.json({ status: "ok", message: "Scout Backend · Viral Acquisition" }));

app.post("/scout", async (req, res) => {
  try {
    const { niche, size, count } = req.body;
    const userMsg = `Cerca ${count || 8} marche italiane emergenti nella niche "${niche}". Dimensione: ${size || "5k-50k followers"}.`;
    const raw = await callClaude(SCOUT_PROMPT, userMsg);
    const clean = raw.replace(/```json|```|`/g, "").trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { const m = clean.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { marques: [] }; }
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/email", async (req, res) => {
  try {
    const { nome, sito, instagram, descrizione, niche } = req.body;
    const userMsg = `Brand: ${nome}\nSito: ${sito || "N/A"}\nInstagram: ${instagram ? "@" + instagram : "N/A"}\nDescrizione: ${descrizione || ""}\nNiche: ${niche || "beauty"}`;
    const raw = await callClaude(EMAIL_PROMPT, userMsg);
    const clean = raw.replace(/```json|```|`/g, "").trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { const m = clean.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null; }
    if (!parsed) throw new Error("Parsing failed");
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Scout Backend running on port ${PORT}`));
