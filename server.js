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

// ─── Nodemailer ──────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// ─── Google Custom Search ─────────────────────────────────────────────────────
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

// ─── Claude Haiku ─────────────────────────────────────────────────────────────
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

// ─── Sleep helper ─────────────────────────────────────────────────────────────
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({
  status: "ok",
  message: "Scout Backend v5 · Viral Acquisition · Google Search + Gmail"
}));

app.post("/scout", async (req, res) => {
  try {
    const { niche, size, count } = req.body;
    if (!niche) return res.status(400).json({ error: "niche required" });
    const n = parseInt(count) || 8;

    // 6 requêtes Google variées pour maximiser les résultats réels
    const queries = [
      `brand italiani ${niche} shop online`,
      `marchio italiano ${niche} e-commerce`,
      `${niche} made in italy negozio online`,
      `${niche} brand italiano piccolo instagram`,
      `azienda italiana ${niche} vendita online`,
      `startup italiana ${niche} ecommerce`
    ];

    let allResults = [];

    // On attend entre chaque requête pour avoir plus de résultats
    for (const q of queries) {
      try {
        const results = await googleSearch(q);
        console.log(`Query "${q}" → ${results.length} results`);
        allResults = allResults.concat(results);
        await sleep(500); // pause entre requêtes
      } catch (e) {
        console.error("Google query failed:", q, e.message);
      }
    }

    // Dédoublonnage strict + blacklist
    const seen = new Set();
    const blacklist = [
      'amazon', 'ebay', 'etsy', 'facebook', 'instagram', 'tiktok',
      'wikipedia', 'linkedin', 'youtube', 'google', 'pinterest',
      'trustpilot', 'paginegialle', 'tripadvisor', 'corriere',
      'repubblica', 'sole24ore', 'ilsole', 'wired', 'forbes',
      'businessinsider', 'shopify', 'woocommerce', 'prestashop'
    ];

    const uniqueResults = allResults.filter(r => {
      try {
        const domain = new URL(r.link).hostname;
        if (blacklist.some(b => domain.includes(b))) return false;
        if (seen.has(domain)) return false;
        seen.add(domain);
        return true;
      } catch { return false; }
    });

    console.log(`Total unique results after filter: ${uniqueResults.length}`);

    if (uniqueResults.length === 0) {
      return res.status(500).json({ error: "Nessun risultato Google trovato. Riprova tra qualche minuto." });
    }

    // Passe tous les résultats à Claude — il choisit les meilleurs
    const searchContext = uniqueResults.slice(0, 30).map((r, i) =>
      `[${i+1}] NOME: ${r.title} | URL: ${r.link} | INFO: ${r.snippet}`
    ).join("\n");

    const systemPrompt = `Sei un esperto di e-commerce italiano e influencer marketing.
Analizza questa lista di siti web italiani trovati su Google e seleziona i brand e-commerce più interessanti.

REGOLE ASSOLUTE:
1. Usa SOLO i siti presenti nella lista — NON inventare mai URL o nomi
2. Il campo "sito" deve essere ESATTAMENTE l'URL dalla lista (es: www.nomebrand.it)
3. Se un risultato non è un brand e-commerce, IGNORALO
4. Seleziona solo brand con potenziale per influencer marketing

Rispondi SOLO con JSON valido:
{"marques":[{"nome":"Nome Brand","sito":"url-esatto-dalla-lista.it","instagram":"handle_dedotto","descrizione":"descrizione specifica","segnali":"segnali crescita","score":8}]}`;

    const userMsg = `Niche cercata: ${niche}
Target follower: ${size || "5k-50k followers Instagram"}
Numero brand da selezionare: ${n}

Lista siti trovati su Google (usa SOLO questi):
${searchContext}

Seleziona i ${n} migliori brand e-commerce italiani nella niche "${niche}". Copia gli URL ESATTAMENTE come appaiono nella lista.`;

    const raw = await callClaude(systemPrompt, userMsg);
    console.log("Claude raw:", raw.substring(0, 300));

    const parsed = extractJSON(raw);
    if (!parsed || !parsed.marques || parsed.marques.length === 0) {
      return res.status(500).json({
        error: "Nessun brand trovato nei risultati. Riprova.",
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
