import { serve, file } from "bun";

const DATA_DIR = "./data";

// Ensure data directory exists
import { mkdirSync } from "fs";
try { mkdirSync(DATA_DIR); } catch {}

function getDataFile(conversationId: string) {
  return `${DATA_DIR}/${conversationId}.json`;
}

function getMdFile(conversationId: string) {
  return `${DATA_DIR}/${conversationId}.md`;
}

function getStatus(data: any) {
  const pending: string[] = [];
  const unread: string[] = [];

  for (const q of data.questions) {
    const checked = q.options.filter((o: any) => o.checked);
    if (checked.length === 0) {
      pending.push(q.id);
    } else {
      const hasUnread = checked.some((o: any) => !o.seen);
      if (hasUnread) unread.push(q.id);
    }
  }

  return { pending, unread };
}

function questionToMarkdown(q: any, answersOnly = false): string | null {
  const checked = q.options.filter((o: any) => o.checked);

  // In answersOnly mode, skip questions with no answers
  if (answersOnly && checked.length === 0) return null;

  let md = '';

  // Question header with metadata
  const tags = q.tags?.length ? q.tags.map((t: string) => `#${t}`).join(' ') + ' ' : '';
  const label = q.label ? `[${q.label}] ` : '';
  const mode = q.selectMode ? `(${q.selectMode}) ` : '';

  if (tags || label || mode) {
    md += `${tags}${label}${mode}\n`;
  }

  // Parent reference
  if (q.parent_id) {
    md += `> **${q.parent_id}**: ${q.parent_summary || ''}\n`;
  }

  // Question text
  md += `**${q.id}**: ${q.text}\n`;

  // Options - in answersOnly mode, only show checked options without checkboxes
  const opts = answersOnly ? checked : q.options;
  for (const opt of opts) {
    if (opt.id === '_' && !opt.text && !opt.description) continue;
    const marker = opt.marker ? ` ${opt.marker}` : '';
    if (answersOnly) {
      md += `- [${opt.id}]${marker} ${opt.text}\n`;
    } else {
      const check = opt.checked ? 'x' : ' ';
      md += `- [${check}] [${opt.id}]${marker} ${opt.text}\n`;
    }
    if (opt.description) {
      const desc = opt.description.split('\n').map((l: string) => `  > ${l}`).join('\n');
      md += `${desc}\n`;
    }
  }

  return md;
}

function generateMarkdown(conversationId: string, data: any, answersOnly = false): string {
  const status = getStatus(data);
  const parts = data.questions
    .map((q: any) => questionToMarkdown(q, answersOnly))
    .filter((md: string | null) => md !== null);

  // YAML frontmatter
  let frontmatter = '---\n';
  frontmatter += `conversation: ${conversationId}\n`;
  frontmatter += `pending: [${status.pending.join(', ')}]\n`;
  frontmatter += `unread: [${status.unread.join(', ')}]\n`;
  frontmatter += '---\n\n';

  if (parts.length === 0) {
    return frontmatter + (answersOnly ? 'No answers yet.\n' : `# ${conversationId}\n`);
  }

  return frontmatter + `# ${conversationId}\n\n${parts.join('\n')}`;
}

function parseQuestion(chunk: string) {
  const lines = chunk.split("\n");

  let parent_id: string | null = null;
  let parent_summary: string | null = null;
  let id: string | null = null;
  let text = "";
  let label: string | null = null;
  let tags: string[] = [];
  let selectMode: "single" | "multi" | null = null;
  const options: { id: string; text: string; description?: string }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // #tag1 #tag2 - tags
    if (trimmed.startsWith("#") && !trimmed.startsWith("##")) {
      const tagMatches = trimmed.match(/#(\w+)/g);
      if (tagMatches) {
        tags = tagMatches.map(t => t.slice(1));
      }
    }
    // [Label] (single|multi) - label and select mode (but not [A], [B], etc.)
    else if (trimmed.match(/^\[[^\]]{2,}\]/) || trimmed.match(/^\[.+\].*\((single|multi)\)/)) {
      const labelMatch = trimmed.match(/^\[([^\]]+)\]/);
      if (labelMatch) label = labelMatch[1];
      if (trimmed.includes("(single)")) selectMode = "single";
      if (trimmed.includes("(multi)")) selectMode = "multi";
    }
    // > **q1**: summary - linked parent
    else if (trimmed.startsWith("> **")) {
      const match = trimmed.match(/^> \*\*([^*]+)\*\*:\s*(.+)/);
      if (match) {
        parent_id = match[1];
        parent_summary = match[2];
      }
    }
    // **q2**: question text
    else if (trimmed.startsWith("**") && trimmed.includes("**:")) {
      const match = trimmed.match(/^\*\*([^*]+)\*\*:\s*(.+)/);
      if (match) {
        id = match[1];
        text = match[2];
      }
    }
    // [A] option text
    else if (trimmed.match(/^\[[A-Z]\]/)) {
      const match = trimmed.match(/^\[([A-Z])\]\s*(.+)/);
      if (match) {
        options.push({ id: match[1], text: match[2] });
      }
    }
    // > description (for previous option)
    else if (trimmed.startsWith(">") && options.length > 0) {
      const desc = trimmed.slice(1).trim();
      if (desc) {
        options[options.length - 1].description = desc;
      }
    }
  }

  if (!text) return null;

  return { id, parent_id, parent_summary, label, tags, selectMode, text, options };
}

async function loadConversation(conversationId: string) {
  const path = getDataFile(conversationId);
  if (await file(path).exists()) {
    return JSON.parse(await file(path).text());
  }
  return { questions: [], lastRead: null };
}

async function saveConversation(conversationId: string, data: any) {
  await Bun.write(getDataFile(conversationId), JSON.stringify(data, null, 2));
  await Bun.write(getMdFile(conversationId), generateMarkdown(conversationId, data));
}

// Collect new (unseen) answers, optionally marking them as seen
function collectNewAnswers(data: any, markSeen: boolean) {
  const newAnswers = [];

  for (const q of data.questions) {
    const newOpts = q.options.filter((o: any) => o.checked && !o.seen);

    if (newOpts.length > 0) {
      newAnswers.push({
        question_id: q.id,
        label: q.label,
        tags: q.tags,
        question_text: q.text,
        selected: newOpts.map((o: any) => ({ id: o.id, text: o.text, description: o.description, marker: o.marker })),
      });

      if (markSeen) {
        for (const opt of q.options) {
          if (opt.checked) opt.seen = true;
        }
      }
    }
  }

  data.lastRead = Date.now();
  return newAnswers;
}

serve({
  port: 4242,
  idleTimeout: 0, // disable timeout for long-polling
  async fetch(req) {
    const url = new URL(req.url);

    // Serve HTML versions
    // v1: /v1/ or /v1/conversation/:id
    if (url.pathname === "/v1" || url.pathname === "/v1/" || url.pathname.startsWith("/v1/conversation/")) {
      return new Response(file("./index-v1.html"), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // v2: /v2/ or /v2/conversation/:id
    if (url.pathname === "/v2" || url.pathname === "/v2/" || url.pathname.startsWith("/v2/conversation/")) {
      return new Response(file("./index-v2.html"), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // v3: /v3/ or /v3/conversation/:id
    if (url.pathname === "/v3" || url.pathname === "/v3/" || url.pathname.startsWith("/v3/conversation/")) {
      return new Response(file("./index-v3.html"), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // v4: /v4/ or /v4/conversation/:id
    if (url.pathname === "/v4" || url.pathname === "/v4/" || url.pathname.startsWith("/v4/conversation/")) {
      return new Response(file("./index-v4.html"), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // v5: /v5/ or /v5/conversation/:id
    if (url.pathname === "/v5" || url.pathname === "/v5/" || url.pathname.startsWith("/v5/conversation/")) {
      return new Response(file("./index-v5.html"), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Current: / or /conversation/:id
    if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/conversation/")) {
      return new Response(file("./index.html"), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Serve skill.md
    if (url.pathname === "/skill.md") {
      return new Response(file("./skill.md"), {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    // Match /api/conversation/:id/...
    const convMatch = url.pathname.match(/^\/api\/conversation\/([^/]+)\/(.+)$/);
    if (convMatch) {
      const conversationId = convMatch[1];
      const action = convMatch[2];

      // POST /api/conversation/:id/ask.md - add question(s) from markdown
      // Supports multiple questions separated by ---
      if ((action === "ask" || action === "ask.md") && req.method === "POST") {
        const md = await req.text();
        const chunks = md.split(/^---$/m).map(c => c.trim()).filter(c => c);

        const data = await loadConversation(conversationId);
        const ids: string[] = [];

        for (const chunk of chunks) {
          const parsed = parseQuestion(chunk);
          if (!parsed) continue;

          if (!parsed.id) parsed.id = "q" + (data.questions.length + 1);

          // Add [_] as last option if not already present
          if (!parsed.options.some(o => o.id === '_')) {
            parsed.options.push({ id: '_', text: '' });
          }

          data.questions.push({
            ...parsed,
            options: parsed.options.map(opt => ({ ...opt, checked: false, seen: false })),
            created_at: Date.now(),
          });
          ids.push(parsed.id);
        }

        if (ids.length === 0) {
          return new Response(JSON.stringify({ error: "Could not parse any questions" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        await saveConversation(conversationId, data);
        const status = getStatus(data);
        return new Response(JSON.stringify({ ok: true, ids, status }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /api/conversation/:id/answers.md - get answers as markdown
      if (action === "answers.md" && req.method === "GET") {
        const data = await loadConversation(conversationId);
        return new Response(generateMarkdown(conversationId, data, true), {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      }

      // GET /api/conversation/:id/answers - get all checked answers
      if (action === "answers" && req.method === "GET") {
        const data = await loadConversation(conversationId);
        const answers = [];

        for (const q of data.questions) {
          const checkedOpts = q.options.filter((o: any) => o.checked);
          if (checkedOpts.length > 0 || q.freeform_checked) {
            answers.push({
              question_id: q.id,
              question_text: q.text,
              selected: checkedOpts.map((o: any) => ({ id: o.id, text: o.text, marker: o.marker })),
              freeform: q.freeform_checked ? { text: q.freeform, marker: q.freeform_marker } : null,
            });
          }
        }

        const status = getStatus(data);
        return new Response(JSON.stringify({ answers, status }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /api/conversation/:id/answers/new - get new answers since last check
      if (action === "answers/new" && req.method === "GET") {
        const data = await loadConversation(conversationId);
        const newAnswers = collectNewAnswers(data, true);
        await saveConversation(conversationId, data);
        const status = getStatus(data);

        return new Response(JSON.stringify({ answers: newAnswers, status }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /api/conversation/:id/wait or wait.md - long-poll until new answers
      if ((action === "wait" || action === "wait.md") && req.method === "GET") {
        const timeout = parseInt(url.searchParams.get("timeout") || "300000"); // 5 min default
        const wantsMd = action === "wait.md";
        const start = Date.now();

        while (Date.now() - start < timeout) {
          const data = await loadConversation(conversationId);
          const newAnswers = collectNewAnswers(data, false); // peek, don't mark seen yet

          if (newAnswers.length > 0) {
            // Now mark as seen
            collectNewAnswers(data, true);
            await saveConversation(conversationId, data);
            const status = getStatus(data);

            if (wantsMd) {
              return new Response(generateMarkdown(conversationId, data, true), {
                headers: { "Content-Type": "text/markdown; charset=utf-8" },
              });
            }
            return new Response(JSON.stringify({ answers: newAnswers, status }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          await Bun.sleep(500); // poll interval
        }

        // Timeout - return current status
        const data = await loadConversation(conversationId);
        const status = getStatus(data);

        if (wantsMd) {
          return new Response(generateMarkdown(conversationId, data, true), {
            headers: { "Content-Type": "text/markdown; charset=utf-8" },
          });
        }
        return new Response(JSON.stringify({ answers: [], status, timeout: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Legacy: /answers/wait redirects to /wait
      if (action === "answers/wait" && req.method === "GET") {
        const timeout = url.searchParams.get("timeout") || "300000";
        return Response.redirect(`/api/conversation/${conversationId}/wait?timeout=${timeout}`, 302);
      }

      // GET /api/conversation/:id/data - full data
      if (action === "data" && req.method === "GET") {
        const data = await loadConversation(conversationId);
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // POST /api/conversation/:id/data - save full data
      if (action === "data" && req.method === "POST") {
        const body = await req.json();
        await saveConversation(conversationId, body);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // DELETE /api/conversation/:id/data - clear conversation
      if (action === "data" && req.method === "DELETE") {
        await saveConversation(conversationId, { questions: [], lastRead: null });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Legacy: GET /api/data - for backwards compat, use "default" conversation
    if (url.pathname === "/api/data" && req.method === "GET") {
      const data = await loadConversation("default");
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Legacy: POST /api/data
    if (url.pathname === "/api/data" && req.method === "POST") {
      const body = await req.json();
      await saveConversation("default", body);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log("Server running at http://localhost:4242");
