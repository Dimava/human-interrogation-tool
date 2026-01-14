# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Human Interrogation Tool is an async questionnaire system for human-in-the-loop workflows. An LLM posts markdown-formatted questions to the server, a human answers via web UI, and the LLM polls for responses.

## Commands

```bash
bun install          # Install dependencies
bun run server.ts    # Start server on port 4242
bun run dev          # Dev mode with auto-reload
```

No build step - Bun runs TypeScript directly.

## Development Philosophy

**HARD ZERO ON LEGACY**: Better to stash broken data and start from scratch than have poor quality code. Don't preserve backwards compatibility at the cost of code quality.

**Polish Three Times**: When a change is done, working, and tested, it's often still not perfect. Review, polish, reread, and review again before considering it complete.

## Architecture

**Single-file server** (`server.ts`): Bun HTTP server handling all API routes and serving static HTML.

**Data flow**:
1. LLM POSTs questions to `/api/conversation/{id}/ask.md`
2. Questions stored in `./data/{id}.json` and `.md` mirror
3. Human visits `http://localhost:4242/v/{id}` to answer
4. LLM polls `/api/conversation/{id}/wait.md` (long-poll, 5 min default)

**Question format** (markdown → JSON):
```
#tag1 #tag2
[Label] (single|multi)
**question-id**: Question text?
[A] Option text
    > Optional description
[B] Another option
---
**q2**: Next question (--- separates multiple questions)
```

**Key data structures**:
- Questions have `id`, `text`, `options[]`, `tags[]`, `label`, `selectMode`
- Options have `id` (A/B/C/etc), `text`, `description?`, `checked`, `seen`, `marker?`
- `seen` tracks whether LLM has retrieved the answer

**Frontend** (`index.html`): Vue 3 SPA with no build. Polls for new questions every second, tracks local modifications, supports emoji markers via shortcuts (`\yes`, `\no`, etc).

## API Endpoints

All under `/api/conversation/{id}/`:
- `POST ask.md` - Add questions (markdown body, `---` separates multiple)
- `GET wait.md` - Long-poll for answers (returns md with YAML frontmatter)
- `GET answers.md` - All answered questions as markdown
