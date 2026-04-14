const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.ANTHROPIC_API_KEY;

async function callClaudeMemory(systemPrompt, userMessage) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return (data.content || []).filter(b => b.type === "text").map(b => b.text || "").join("").trim();
}

async function callClaudeWeb(systemPrompt, userMessage) {
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
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const content = data.content || [];
    const textBlocks = content.filter(b => b.type === "text");
    if (textBlocks.length > 0) finalText = textBlocks.map(b => b.text || "").join("").trim();
    if (data.stop_reason === "end_turn") break;
    const toolUseBlocks = content.filter(b => b.type === "tool_use");
    if (toolUseBlocks.length === 0) break;
    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: toolUseBlocks.map(tu => ({ type: "tool_result", tool_use_id: tu.id, content: Array.isArray(tu.content) ? tu.content : [{ type: "text", text: String(tu.content || "done") }] })) });
  }
  return finalText;
}

function extractJSON(text) {
  // Remove markdown code blocks
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  // Try direct parse
  try { return JSON.parse(text); } catch {}
  // Try to find JSON object
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  // Try to find JSON array
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return { marques: JSON.parse(arrMatch[0]) }; } catch {}
  }
  return null;
}

app.get("/", (req, res) => res.json({ status: "ok", message: "Scout Backend v3 · Viral Acquisition" }));

app.post("/scout", async (req, res) => {
  try {
    const { niche, size, count, mode } = req.body;
    if (!niche) return res.status(400).json({ error: "niche required" });

    const useWeb = mode === "web";
    const n = parseInt(count) || 8;

    const systemPrompt = useWeb
      ? `Sei un esperto di e-commerce italiano. Usa la ricerca web per trovare brand italiani emergenti nella niche richiesta. Rispondi SOLO con JSON valido, nessun testo aggiuntivo: {"marques":[{"nome":"...","sito":"...","instagram":"...","descrizione":"...","segnali":"...","score":8}]}`
      : `Sei un esperto del mercato e-commerce italiano 2019-2024. Elenca ${n} brand italiani REALI o molto plausibili nella niche richiesta con e-commerce attivo e presenza social. Rispondi SOLO con JSON valido, nessun altro testo, nessun markdown: {"marques":[{"nome":"NomeBrand","sito":"nomebrand.it","instagram":"nomebrand","descrizione":"Descrizione specifica dei prodotti","segnali":"Segnali crescita specifici","score":8}]}`;

    const userMsg = `Trova ${n} brand italiani emergenti nella niche "${niche}". Target: ${size || "5k-50k followers Instagram"}.`;

    const raw = useWeb ? await callClaudeWeb(systemPrompt, userMsg) : await callClaudeMemory(systemPrompt, userMsg);
    
    console.log("Raw response:", raw.substring(0, 200));
    
    const parsed = extractJSON(raw);
    
    if (!parsed || !parsed.marques || parsed.marques.length === 0) {
      console.error("Parse failed or empty. Raw:", raw.substring(0, 500));
      return res.status(500).json({ error: "Nessun risultato trovato. Riprova.", raw: raw.substring(0, 300) });
    }

    res.json({ ...parsed, mode: useWeb ? "web" : "memory" });
  } catch (err) {
    console.error("Scout error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/email", async (req, res) => {
  try {
    const { nome, sito, instagram, descrizione, niche, mode } = req.body;
    if (!nome) return res.status(400).json({ error: "nome required" });

    const useWeb = mode === "web";

    const systemPrompt = useWeb
      ? `Agente prospection Viral Acquisition, agenzia influencer marketing italiana. Modello: 100% performance, zero costi anticipati. Cerca info reali sul brand e rispondi SOLO con JSON valido: {"analisi":"...","oggetto":"...","email":"...","score":8,"score_note":"..."}`
      : `Agente prospection Viral Acquisition, agenzia influencer marketing italiana. Modello: 100% performance, zero costi anticipati. Rispondi SOLO con JSON valido senza markdown: {"analisi":"3 righe sul brand","oggetto":"oggetto email specifico","email":"email italiana max 120 parole, firma: Diaz | Viral Acquisition | viralacquisition@gmail.com, NO commissioni NO percentuali, evidenzia zero rischio","score":8,"score_note":"motivazione specifica"}`;

    const userMsg = `Brand: ${nome}\nSito: ${sito || "N/A"}\nInstagram: ${instagram ? "@" + instagram : "N/A"}\nDescrizione: ${descrizione || ""}\nNiche: ${niche || "beauty"}`;

    const raw = useWeb ? await callClaudeWeb(systemPrompt, userMsg) : await callClaudeMemory(systemPrompt, userMsg);
    
    const parsed = extractJSON(raw);
    if (!parsed) throw new Error("Impossibile generare l'email. Riprova.");
    res.json(parsed);
  } catch (err) {
    console.error("Email error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Scout Backend v3 running on port ${PORT}`));
