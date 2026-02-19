# 🔬 Research Synthesizer API

Multi-source research synthesis — agent-native, local Ollama inference.

Give it 2–8 URLs or text snippets, and it returns:
- **Synthesis** — coherent overall analysis
- **Key Themes** — 3–6 main themes across sources
- **Consensus** — points sources agree on
- **Contradictions** — points sources disagree on
- **Per-source summaries** with quality scores (high/medium/low)
- **Confidence score**

Zero cost. No external APIs. Fully local via Ollama.

---

## Quick Start

```bash
npm install
npm start   # runs on port 4203
```

Requires [Ollama](https://ollama.ai) with `qwen3:8b-q8_0` (or any model via `OLLAMA_MODEL` env).

---

## API

### `POST /synthesize`

```json
{
  "sources": [
    { "type": "url", "content": "https://example.com/article" },
    { "type": "text", "content": "Raw text content..." }
  ],
  "topic": "What are the main arguments for X?",
  "depth": "brief"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sources` | array | ✅ | 2–8 items with `type` ("url"\|"text") + `content` |
| `topic` | string | ❌ | Focus question to guide synthesis |
| `depth` | string | ❌ | `"brief"` (default) or `"detailed"` |

**Response:**
```json
{
  "synthesis": "Overall analysis...",
  "keyThemes": ["theme1", "theme2"],
  "consensus": ["Point all sources agree on"],
  "contradictions": ["Source A says X but Source B says Y"],
  "sources": [
    { "id": 0, "label": "Source 1", "summary": "...", "quality": "high" }
  ],
  "confidence": 0.80,
  "topic": "...",
  "depth": "brief",
  "sourceCount": 2,
  "processingTimeMs": 4200
}
```

### Other Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Status + model availability |
| `GET` | `/skill.md` | Agent discovery doc |
| `GET` | `/schema` | Full JSON schema |
| `GET` | `/` | Browser UI |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4203` | HTTP port |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `OLLAMA_MODEL` | `qwen3:8b-q8_0` | Model to use |

---

## Agent Usage

```bash
# From any agent, just POST to:
curl -X POST http://localhost:4203/synthesize \
  -H 'Content-Type: application/json' \
  -d '{"sources":[...],"topic":"..."}'

# Or read the skill doc:
curl http://localhost:4203/skill.md
```

---

## Service Family

| Service | Port | What It Does |
|---------|------|-------------|
| Fact-Checker API | 4201 | Claim verification via web search |
| Smart Summarizer API | 4202 | URL/text → structured summary |
| **Research Synthesizer** | **4203** | **Multi-source synthesis** |

---

Built by Jarvis · Part of the agent-native services collection