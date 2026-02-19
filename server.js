/**
 * Research Synthesizer API — Agent-Native Service
 *
 * Takes multiple sources (URLs or text), fetches/processes each, then uses
 * Ollama (qwen3:8b) to synthesize them into a structured analysis with key
 * themes, consensus points, contradictions, and an overall synthesis.
 *
 * Endpoints:
 *   GET  /health       — Service health + model status
 *   GET  /skill.md     — Agent discovery doc
 *   GET  /schema       — Request/response schema
 *   POST /synthesize   — Synthesize 2–8 sources around a topic
 *   GET  /             — HTML interface
 *
 * Port: 4203
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 4203;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b-q8_0';

app.use(cors());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(express.json({ limit: '4mb' }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ResearchSynthBot/1.0 (+http://localhost:4203/skill.md)',
        'Accept': 'text/html,text/plain',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text') && !ct.includes('json')) {
      throw new Error(`Non-text content-type: ${ct}`);
    }
    const raw = await res.text();
    return extractText(raw);
  } finally {
    clearTimeout(timeout);
  }
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 12000); // cap per source
}

async function ollamaGenerate(prompt, expectJson = true) {
  const systemPrompt = expectJson
    ? 'You are a research analyst. Respond ONLY with valid JSON — no markdown, no backticks, no commentary before or after.'
    : 'You are a research analyst. Be concise and factual.';

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      system: systemPrompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 2048 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.response?.trim() || '';
}

function extractJson(text) {
  // Try direct parse
  try { return JSON.parse(text); } catch {}
  // Extract from code block
  const m = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (m) try { return JSON.parse(m[1]); } catch {}
  // Find first { ... }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error('Could not extract JSON from LLM response');
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  let ollamaOk = false;
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    ollamaOk = r.ok;
  } catch {}
  res.json({
    status: ollamaOk ? 'ok' : 'degraded',
    service: 'research-synthesizer',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    model: MODEL,
    ollama: ollamaOk ? 'connected' : 'unreachable',
    maxSources: 8,
  });
});

// ─── Skill.md ─────────────────────────────────────────────────────────────────

app.get('/skill.md', (req, res) => {
  res.type('text/plain').send(`# Research Synthesizer API

## What It Does
Multi-source research synthesis. Give it 2–8 URLs or text snippets, and it returns a
structured synthesis: key themes, consensus points, contradictions, per-source summaries,
and an overall analysis — all via local Ollama inference (free, no API keys needed).

## Base URL
http://localhost:4203

## Core Endpoint

### POST /synthesize
Synthesize multiple sources around a topic.

**Request:**
\`\`\`json
{
  "sources": [
    { "type": "url", "content": "https://example.com/article" },
    { "type": "text", "content": "Raw text content..." }
  ],
  "topic": "What are the main arguments for X?",
  "depth": "brief"
}
\`\`\`

Fields:
- \`sources\` (required): Array of 2–8 sources. Each has \`type\` ("url" | "text") and \`content\`.
- \`topic\` (optional): Focus question or research topic. Guides the synthesis.
- \`depth\` (optional): "brief" (default) | "detailed". Detailed = deeper analysis, slower.

**Response:**
\`\`\`json
{
  "synthesis": "Overall synthesis paragraph...",
  "keyThemes": ["theme1", "theme2"],
  "consensus": ["Point all sources agree on"],
  "contradictions": ["Point source A says X but source B says Y"],
  "sources": [
    { "id": 0, "label": "Source 1", "summary": "...", "quality": "high" }
  ],
  "confidence": 0.82,
  "topic": "What are...",
  "depth": "brief",
  "sourceCount": 2,
  "processingTimeMs": 4200
}
\`\`\`

## Other Endpoints
- \`GET /health\` — Status + model availability
- \`GET /schema\` — Full JSON schema
- \`GET /\` — Browser UI

## Notes
- Uses local Ollama (${MODEL}) — free, private, no rate limits
- URL sources are fetched and text-extracted automatically
- Quality scores: high / medium / low based on content density
- Processing time scales with source count and depth setting
`);
});

// ─── Schema ───────────────────────────────────────────────────────────────────

app.get('/schema', (req, res) => {
  res.json({
    service: 'Research Synthesizer API',
    version: '1.0.0',
    endpoints: {
      synthesize: {
        method: 'POST',
        path: '/synthesize',
        description: 'Synthesize 2–8 sources into a structured research analysis',
        request: {
          sources: {
            type: 'array',
            required: true,
            minItems: 2,
            maxItems: 8,
            items: {
              type: { type: 'string', enum: ['url', 'text'] },
              content: { type: 'string', description: 'URL or raw text' },
            },
          },
          topic: { type: 'string', required: false, description: 'Focus question or topic' },
          depth: { type: 'string', enum: ['brief', 'detailed'], default: 'brief' },
        },
        response: {
          synthesis: 'string — overall synthesis paragraph',
          keyThemes: 'string[] — 3–6 main themes across all sources',
          consensus: 'string[] — points where sources agree',
          contradictions: 'string[] — points where sources disagree or contradict',
          sources: 'array — per-source summary + quality score',
          confidence: 'number 0–1 — synthesis confidence',
          topic: 'string — the topic used',
          depth: 'string — depth used',
          sourceCount: 'number',
          processingTimeMs: 'number',
        },
      },
    },
  });
});

// ─── Synthesize ───────────────────────────────────────────────────────────────

app.post('/synthesize', async (req, res) => {
  const start = Date.now();

  const { sources, topic, depth = 'brief' } = req.body || {};

  // Validate
  if (!Array.isArray(sources) || sources.length < 2) {
    return res.status(400).json({ error: 'sources must be an array of at least 2 items' });
  }
  if (sources.length > 8) {
    return res.status(400).json({ error: 'Maximum 8 sources allowed per request' });
  }
  for (const [i, s] of sources.entries()) {
    if (!s.type || !['url', 'text'].includes(s.type)) {
      return res.status(400).json({ error: `sources[${i}].type must be "url" or "text"` });
    }
    if (!s.content || typeof s.content !== 'string' || s.content.trim().length < 10) {
      return res.status(400).json({ error: `sources[${i}].content is required and must be at least 10 chars` });
    }
  }

  // Fetch URL sources
  const fetched = [];
  for (const [i, s] of sources.entries()) {
    if (s.type === 'url') {
      try {
        const text = await fetchUrl(s.content);
        fetched.push({ id: i, label: s.label || `Source ${i + 1} (${s.content})`, text, url: s.content });
      } catch (err) {
        fetched.push({ id: i, label: s.label || `Source ${i + 1}`, text: '', error: err.message, url: s.content });
      }
    } else {
      fetched.push({ id: i, label: s.label || `Source ${i + 1}`, text: s.content.slice(0, 12000) });
    }
  }

  // Build synthesis prompt
  const topicLine = topic ? `Research Topic / Focus Question: ${topic}\n\n` : '';
  const depthInstructions = depth === 'detailed'
    ? 'Provide deep analysis. Synthesis should be 3–5 paragraphs. List 5–8 key themes, multiple consensus and contradiction points.'
    : 'Be concise. Synthesis should be 2–3 paragraphs. List 3–5 key themes.';

  const sourceDocs = fetched.map((s, idx) =>
    `--- SOURCE ${idx + 1}: ${s.label} ---\n${s.text || `[FETCH ERROR: ${s.error}]`}\n`
  ).join('\n');

  const prompt = `${topicLine}You are synthesizing ${fetched.length} research sources into a structured analysis.

${depthInstructions}

Evaluate each source's quality as:
- "high": detailed, specific, well-sourced content
- "medium": general but relevant content
- "low": thin, vague, or retrieval-failed content

SOURCES:
${sourceDocs}

Return ONLY a JSON object with this exact structure:
{
  "synthesis": "Overall synthesis text covering the main findings across all sources...",
  "keyThemes": ["theme 1", "theme 2", "theme 3"],
  "consensus": ["Point sources generally agree on", "Another area of agreement"],
  "contradictions": ["Source A says X but Source B says Y", "..."],
  "sources": [
    { "id": 0, "label": "Source 1 label", "summary": "1–2 sentence summary", "quality": "high" },
    { "id": 1, "label": "Source 2 label", "summary": "1–2 sentence summary", "quality": "medium" }
  ],
  "confidence": 0.80
}`;

  let raw;
  try {
    raw = await ollamaGenerate(prompt, true);
  } catch (err) {
    return res.status(503).json({ error: 'LLM unavailable', detail: err.message });
  }

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch {
    return res.status(500).json({ error: 'Failed to parse LLM response', raw: raw.slice(0, 500) });
  }

  res.json({
    synthesis: parsed.synthesis || '',
    keyThemes: parsed.keyThemes || [],
    consensus: parsed.consensus || [],
    contradictions: parsed.contradictions || [],
    sources: (parsed.sources || []).map((s, i) => ({
      id: s.id ?? i,
      label: s.label || fetched[i]?.label || `Source ${i + 1}`,
      summary: s.summary || '',
      quality: ['high', 'medium', 'low'].includes(s.quality) ? s.quality : 'medium',
      url: fetched[i]?.url,
    })),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
    topic: topic || null,
    depth,
    sourceCount: fetched.length,
    processingTimeMs: Date.now() - start,
  });
});

// ─── HTML UI ──────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Research Synthesizer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; padding: 2rem; }
    h1 { font-size: 1.8rem; margin-bottom: 0.3rem; color: #58a6ff; }
    .subtitle { color: #8b949e; margin-bottom: 2rem; font-size: 0.95rem; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 1.5rem; margin-bottom: 1.5rem; }
    label { display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; }
    input, textarea, select { width: 100%; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e1e4e8; padding: 0.6rem 0.8rem; font-size: 0.9rem; font-family: inherit; }
    input:focus, textarea:focus { outline: none; border-color: #58a6ff; }
    textarea { resize: vertical; min-height: 80px; }
    .source-row { display: flex; gap: 0.6rem; margin-bottom: 0.8rem; align-items: flex-start; }
    .source-row select { width: 90px; flex-shrink: 0; }
    .source-row textarea { flex: 1; min-height: 60px; }
    .source-row button { background: #21262d; border: 1px solid #30363d; color: #f85149; border-radius: 6px; padding: 0.4rem 0.7rem; cursor: pointer; flex-shrink: 0; margin-top: 0; }
    .btn-add { background: #21262d; border: 1px solid #30363d; color: #58a6ff; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; margin-right: 0.5rem; }
    .btn-go { background: #238636; border: 1px solid #2ea043; color: #fff; padding: 0.6rem 2rem; border-radius: 6px; cursor: pointer; font-size: 0.95rem; }
    .btn-go:disabled { opacity: 0.5; cursor: default; }
    #result { white-space: pre-wrap; font-family: 'SF Mono', Consolas, monospace; font-size: 0.8rem; color: #8b949e; max-height: 60vh; overflow-y: auto; }
    .tag { display: inline-block; background: #21262d; border: 1px solid #30363d; border-radius: 20px; padding: 0.2rem 0.7rem; font-size: 0.8rem; margin: 0.2rem; color: #79c0ff; }
    .section-title { color: #58a6ff; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; margin-top: 1rem; }
    .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 4px; font-size: 0.75rem; }
    .badge-high { background: #1a4731; color: #56d364; }
    .badge-medium { background: #3d2b00; color: #e3b341; }
    .badge-low { background: #3d0e0e; color: #f85149; }
    .source-card { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 0.8rem; margin-bottom: 0.6rem; }
    #spinner { display: none; color: #58a6ff; margin-left: 1rem; }
  </style>
</head>
<body>
  <h1>🔬 Research Synthesizer</h1>
  <p class="subtitle">Multi-source synthesis · Local Ollama · Agent-native JSON API</p>

  <div class="card">
    <label>Research Topic / Focus Question (optional)</label>
    <input id="topic" type="text" placeholder="e.g. What are the main arguments for renewable energy adoption?" />
  </div>

  <div class="card">
    <label>Sources (2–8 URLs or text)</label>
    <div id="sources">
      <div class="source-row">
        <select><option value="url">URL</option><option value="text">Text</option></select>
        <textarea placeholder="https://example.com or paste text..."></textarea>
        <button onclick="removeSource(this)">✕</button>
      </div>
      <div class="source-row">
        <select><option value="url">URL</option><option value="text">Text</option></select>
        <textarea placeholder="https://example.com or paste text..."></textarea>
        <button onclick="removeSource(this)">✕</button>
      </div>
    </div>
    <button class="btn-add" onclick="addSource()">+ Add Source</button>
    <select id="depth" style="width:130px; display:inline-block; margin-left:0.5rem;">
      <option value="brief">Brief</option>
      <option value="detailed">Detailed</option>
    </select>
    <button class="btn-go" id="goBtn" onclick="synthesize()">Synthesize</button>
    <span id="spinner">⏳ Processing…</span>
  </div>

  <div class="card" id="resultCard" style="display:none">
    <div id="richResult"></div>
    <div class="section-title" style="margin-top:1.5rem">Raw JSON</div>
    <pre id="result"></pre>
  </div>

  <script>
    function addSource() {
      const row = document.createElement('div');
      row.className = 'source-row';
      row.innerHTML = '<select><option value="url">URL</option><option value="text">Text</option></select><textarea placeholder="https://example.com or paste text..."></textarea><button onclick="removeSource(this)">✕</button>';
      document.getElementById('sources').appendChild(row);
    }
    function removeSource(btn) {
      const rows = document.querySelectorAll('.source-row');
      if (rows.length > 2) btn.closest('.source-row').remove();
    }
    async function synthesize() {
      const rows = document.querySelectorAll('.source-row');
      const sources = [...rows].map(r => ({
        type: r.querySelector('select').value,
        content: r.querySelector('textarea').value.trim(),
      })).filter(s => s.content.length > 0);

      if (sources.length < 2) { alert('Please add at least 2 sources'); return; }

      const btn = document.getElementById('goBtn');
      const spinner = document.getElementById('spinner');
      btn.disabled = true;
      spinner.style.display = 'inline';

      try {
        const res = await fetch('/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sources,
            topic: document.getElementById('topic').value.trim() || undefined,
            depth: document.getElementById('depth').value,
          }),
        });
        const data = await res.json();
        document.getElementById('result').textContent = JSON.stringify(data, null, 2);

        // Render rich view
        const rich = document.getElementById('richResult');
        rich.innerHTML = '';

        if (data.synthesis) {
          const st = document.createElement('div');
          st.innerHTML = '<div class="section-title">Synthesis</div><p style="line-height:1.6; color:#c9d1d9">' + escHtml(data.synthesis) + '</p>';
          rich.appendChild(st);
        }
        if (data.keyThemes?.length) {
          const t = document.createElement('div');
          t.innerHTML = '<div class="section-title">Key Themes</div>' + data.keyThemes.map(x => '<span class="tag">' + escHtml(x) + '</span>').join('');
          rich.appendChild(t);
        }
        if (data.consensus?.length) {
          const c = document.createElement('div');
          c.innerHTML = '<div class="section-title">✅ Consensus</div><ul style="padding-left:1.5rem; color:#c9d1d9; line-height:2">' + data.consensus.map(x => '<li>' + escHtml(x) + '</li>').join('') + '</ul>';
          rich.appendChild(c);
        }
        if (data.contradictions?.length) {
          const cr = document.createElement('div');
          cr.innerHTML = '<div class="section-title">⚡ Contradictions</div><ul style="padding-left:1.5rem; color:#c9d1d9; line-height:2">' + data.contradictions.map(x => '<li>' + escHtml(x) + '</li>').join('') + '</ul>';
          rich.appendChild(cr);
        }
        if (data.sources?.length) {
          const srcs = document.createElement('div');
          srcs.innerHTML = '<div class="section-title">Sources</div>' + data.sources.map(s =>
            '<div class="source-card"><strong style="color:#c9d1d9">' + escHtml(s.label) + '</strong> <span class="badge badge-' + s.quality + '">' + s.quality + '</span><p style="margin-top:0.4rem; color:#8b949e; font-size:0.85rem">' + escHtml(s.summary) + '</p></div>'
          ).join('');
          rich.appendChild(srcs);
        }

        const meta = document.createElement('p');
        meta.style.cssText = 'margin-top:1rem; font-size:0.8rem; color:#484f58';
        meta.textContent = \`Confidence: \${Math.round((data.confidence||0)*100)}% · \${data.sourceCount} sources · \${data.processingTimeMs}ms\`;
        rich.appendChild(meta);

        document.getElementById('resultCard').style.display = 'block';
      } catch(e) {
        alert('Error: ' + e.message);
      } finally {
        btn.disabled = false;
        spinner.style.display = 'none';
      }
    }
    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
  </script>
</body>
</html>`);
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[research-synthesizer] 🔬 Running on http://localhost:${PORT}`);
  console.log(`[research-synthesizer] Model: ${MODEL} via ${OLLAMA_URL}`);
});