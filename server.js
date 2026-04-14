const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

// ─── Google Custom Search ───────────────────────────────────────────────────
async function googleSearch(query) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=10`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error("Google Search error: " + data.error.message);
  return (data.items || []).map(item => ({
    title: item.title,
    link: item.link,
    snippet: item.snippet
  }));
}

// ─── Claude Haiku (génération uniquement) ──────────────────────────────────
async function callClaude(systemPrompt, userMessage) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
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

// ─── Extract JSON ───────────────────────────────────────────────────────────
function extractJSON(text) {
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return { marques: JSON.parse(arrMatch[0]) }; } catch {} }
  return null;
}

// ─── Routes ─────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", message: "Scout Backend v4 · Viral Acquisition · Google Search" }));

app.post("/scout", async (req, res) => {
  try {
    const { niche, size, count } = req.body;
    if (!niche) return res.status(400).json({ error: "niche required" });
    const n = parseInt(count) || 8;

    // 1. Google Search → résultats réels
    const queries = [
      `brand italiani ${niche} e-commerce emergenti`,
      `marchi italiani ${niche} shop online piccoli`,
      `brand ${niche} made in italy negozio online`
    ];

    let allResults = [];
    for (const q of queries) {
      try {
        const results = await googleSearch(q);
        allResults = allResults.concat(results);
      } catch (e) {
        console.error("Google query failed:", q, e.message);
      }
    }

    // Dédoublonnage par domaine
    const seen = new Set();
    const uniqueResults = allResults.filter(r => {
      try {
        const domain = new URL(r.link).hostname;
        if (seen.has(domain)) return false;
        seen.add(domain);
        return true;
      } catch { return false; }
    });

    const searchContext = uniqueResults.slice(0, 20).map(r =>
      `- ${r.title} | ${r.link} | ${r.snippet}`
    ).join("\n");

    // 2. Claude Haiku → analyse + structuration
    const systemPrompt = `Sei un esperto di e-commerce italiano e influencer marketing. 
Analizza i risultati di ricerca reali forniti e identifica i brand italiani emergenti più interessanti nella niche richiesta.
Seleziona solo brand con sito e-commerce attivo e potenziale per influencer marketing.
Rispondi SOLO con JSON valido, nessun testo aggiuntivo:
{"marques":[{"nome":"...","sito":"...","instagram":"...","descrizione":"...","segnali":"...","score":8}]}`;

    const userMsg = `Niche: ${niche}
Target follower: ${size || "5k-50k followers Instagram"}
Numero brand da selezionare: ${n}

Risultati Google reali:
${searchContext || "Nessun risultato Google disponibile, usa le tue conoscenze sui brand italiani reali."}

Seleziona i ${n} brand più promettenti. Per l'instagram, deduci il profilo dal nome del brand (es. sito nomebrand.it → @nomebrand). Score 1-10 basato su potenziale influencer marketing.`;

    const raw = await callClaude(systemPrompt, userMsg);
    console.log("Raw Claude response:", raw.substring(0, 200));

    const parsed = extractJSON(raw);
    if (!parsed || !parsed.marques || parsed.marques.length === 0) {
      console.error("Parse failed. Raw:", raw.substring(0, 500));
      return res.status(500).json({ error: "Nessun risultato trovato. Riprova.", raw: raw.substring(0, 300) });
    }

    res.json({ ...parsed, mode: "google", totalFound: uniqueResults.length });

  } catch (err) {
    console.error("Scout error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/email", async (req, res) => {
  try {
    const { nome, sito, instagram, descrizione, niche } = req.body;
    if (!nome) return res.status(400).json({ error: "nome required" });

    // 1. Google Search → infos réelles sur le brand
    let brandContext = "";
    try {
      const results = await googleSearch(`${nome} brand italiano ${niche || ""} e-commerce`);
      brandContext = results.slice(0, 5).map(r =>
        `- ${r.title} | ${r.link} | ${r.snippet}`
      ).join("\n");
    } catch (e) {
      console.error("Google brand search failed:", e.message);
    }

    // 2. Claude Haiku → génération email
    const systemPrompt = `Agente prospection Viral Acquisition, agenzia influencer marketing italiana. 
Modello: 100% performance, zero costi anticipati per il brand.
Rispondi SOLO con JSON valido senza markdown:
{"analisi":"3 righe sul brand","oggetto":"oggetto email specifico e personalizzato","email":"email italiana max 120 parole personalizzata sul brand, firma: Diaz | Viral Acquisition | viralacquisition@gmail.com, NO commissioni NO percentuali, evidenzia zero rischio finanziario","score":8,"score_note":"motivazione specifica"}`;

    const userMsg = `Brand: ${nome}
Sito: ${sito || "N/A"}
Instagram: ${instagram ? "@" + instagram : "N/A"}
Descrizione: ${descrizione || ""}
Niche: ${niche || "beauty"}

Info reali trovate su Google:
${brandContext || "Nessuna info aggiuntiva trovata."}`;

    const raw = await callClaude(systemPrompt, userMsg);
    const parsed = extractJSON(raw);
    if (!parsed) throw new Error("Impossibile generare l'email. Riprova.");

    res.json(parsed);

  } catch (err) {
    console.error("Email error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Scout Backend v4 running on port ${PORT}`));
