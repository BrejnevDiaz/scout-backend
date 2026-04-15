const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;

// ─── Nodemailer ─────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// ─── Google Custom Search ────────────────────────────────────────────────────
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

// ─── Claude Haiku ────────────────────────────────────────────────────────────
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

// ─── Extract JSON ─────────────────────────────────────────────────────────────
function extractJSON(text) {
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return { marques: JSON.parse(arrMatch[0]) }; } catch {} }
  return null;
}

// ─── Routes ──────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({
  status: "ok",
  message: "Scout Backend v5 · Viral Acquisition · Google Search + Gmail"
}));

app.post("/scout", async (req, res) => {
  try {
    const { niche, size, count } = req.body;
    if (!niche) return res.status(400).json({ error: "niche required" });
    const n = parseInt(count) || 8;

    const queries = [
      `brand italiani ${niche} shop online`,
      `marchio italiano ${niche} e-commerce emergente`,
      `${niche} made in italy brand piccolo acquista`,
      `${niche} italia brand instagram influencer`
    ];

    let allResults = [];
    for (const q of queries) {
      try {
        const results = await googleSearch(q);
        console.log(`Query "${q}" → ${results.length} results`);
        allResults = allResults.concat(results);
      } catch (e) {
        console.error("Google query failed:", q, e.message);
      }
    }

    // Dédoublonnage + blacklist
    const seen = new Set();
    const blacklist = ['amazon', 'ebay', 'etsy', 'facebook', 'instagram',
      'wikipedia', 'linkedin', 'youtube', 'google', 'pinterest',
      'trustpilot', 'paginegialle', 'tripadvisor', 'corriere', 'repubblica'];

    const uniqueResults = allResults.filter(r => {
      try {
        const domain = new URL(r.link).hostname;
        if (blacklist.some(b => domain.includes(b))) return false;
        if (seen.has(domain)) return false;
        seen.add(domain);
        return true;
      } catch { return false; }
    });

    console.log(`Total unique results: ${uniqueResults.length}`);

    const searchContext = uniqueResults.slice(0, 20).map(r =>
      `- ${r.title} | ${r.link} | ${r.snippet}`
    ).join("\n");

    const systemPrompt = `Sei un esperto di e-commerce italiano e influencer marketing.
Analizza i risultati di ricerca forniti e identifica brand italiani emergenti interessanti.
Se i risultati non contengono brand adatti, usa le tue conoscenze sui brand italiani reali nella niche richiesta.
Rispondi SOLO con JSON valido, nessun testo aggiuntivo:
{"marques":[{"nome":"...","sito":"dominio.it","instagram":"handle","descrizione":"...","segnali":"...","score":8}]}`;

    const userMsg = `Niche: ${niche}
Target: ${size || "5k-50k followers Instagram"}
Numero brand: ${n}

Risultati Google:
${searchContext || "Nessun risultato Google disponibile."}

Seleziona ${n} brand italiani reali e emergenti nella niche ${niche}. Usa i risultati Google se disponibili, altrimenti usa le tue conoscenze sui brand italiani reali.`;

    const raw = await callClaude(systemPrompt, userMsg);
    console.log("Claude raw:", raw.substring(0, 200));

    const parsed = extractJSON(raw);
    if (!parsed || !parsed.marques || parsed.marques.length === 0) {
      return res.status(500).json({
        error: "Nessun risultato trovato. Riprova.",
        raw: raw.substring(0, 300)
      });
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

    let brandContext = "";
    try {
      const results = await googleSearch(`${nome} brand italiano ${niche || ""} e-commerce`);
      brandContext = results.slice(0, 5).map(r =>
        `- ${r.title} | ${r.link} | ${r.snippet}`
      ).join("\n");
    } catch (e) {
      console.error("Google brand search failed:", e.message);
    }

    const systemPrompt = `Agente prospection Viral Acquisition, agenzia influencer marketing italiana.
Modello: 100% performance, zero costi anticipati per il brand.
Rispondi SOLO con JSON valido senza markdown:
{"analisi":"3 righe specifiche sul brand","oggetto":"oggetto email breve e personalizzato","email":"email italiana max 100 parole, personalizzata, firma: Diaz | Viral Acquisition | viralacquisition@gmail.com, NO commissioni NO percentuali, evidenzia zero rischio finanziario","score":8,"score_note":"motivazione specifica"}`;

    const userMsg = `Brand: ${nome}
Sito: ${sito || "N/A"}
Instagram: ${instagram ? "@" + instagram : "N/A"}
Descrizione: ${descrizione || ""}
Niche: ${niche || "beauty"}

Info Google:
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

// ─── Send Email ───────────────────────────────────────────────────────────────
app.post("/send-email", async (req, res) => {
  try {
    const { to, oggetto, email } = req.body;
    if (!to || !oggetto || !email) {
      return res.status(400).json({ error: "to, oggetto, email required" });
    }
    await transporter.sendMail({
      from: `"Diaz · Viral Acquisition" <${process.env.GMAIL_USER}>`,
      to,
      subject: oggetto,
      text: email
    });
    res.json({ success: true, message: `Email inviata a ${to}` });
  } catch (err) {
    console.error("Send email error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Scout Backend v5 running on port ${PORT}`));
