# Lunette la Fée

A voice-first French learning app for Russian-speaking children aged 7–9. Kids speak French with Lunette, a magical fairy AI tutor, and hear both languages through high-quality bilingual text-to-speech.

## How it works

- Child presses the mic button and speaks in French (or Russian using the FR/RU toggle)
- Lunette replies in simple French and asks a follow-up question
- If the child says **"qu'est-ce que c'est [word]"**, Lunette explains the word directly in Russian
- If the child makes a grammar mistake, Lunette gently corrects with a Russian explanation
- Both French and Russian parts are spoken using ElevenLabs multilingual TTS

## Tech stack

- **React + Vite** — frontend
- **Claude Haiku** (Anthropic) — conversational AI tutor
- **ElevenLabs** `eleven_multilingual_v2` — bilingual TTS (French + Russian)
- **Web Speech API** — voice input (Chrome/Edge/Safari)
- **Vercel** — hosting + serverless API routes

## Local development

Requires [Vercel CLI](https://vercel.com/docs/cli) to run the serverless functions locally alongside Vite.

```bash
npm install
npm install -g vercel
vercel dev
```

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | ElevenLabs voice ID (multilingual voice recommended) |

## Deploy to Vercel

1. Push to GitHub
2. Import the repo at [vercel.com/new](https://vercel.com/new)
3. Add the three environment variables in Project Settings
4. Deploy — done
