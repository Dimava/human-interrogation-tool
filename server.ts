import { serve, file } from "bun";

const DATA_DIR = "./data";

// Ensure data directory exists
import { mkdirSync } from "fs";
try { mkdirSync(DATA_DIR); } catch {}

function getDataFile(conversationId: string) {
  return `${DATA_DIR}/${conversationId}.json`;
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

      // POST /api/conversation/:id/ask - add question from markdown
      // Format:
      //   #tag1 #tag2
      //   [Label] (single|multi)
      //   > **parent_id**: parent summary
      //   **q1**: Question text?
      //   [A] Option A
      //       > Description for A
      //   [B] Option B
      //       > Description for B
      if (action === "ask" && req.method === "POST") {
        const md = await req.text();
        const lines = md.trim().split("\n");

        let parent_id: string | null = null;
        let parent_summary: string | null = null;
        let id: string | null = null;
        let text = "";
        let label: string | null = null;
        let tags: string[] = [];
        let selectMode: "single" | "multi" | null = null;
        const options: { id: string; text: string; description?: string }[] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();

          // #tag1 #tag2 - tags
          if (line.startsWith("#") && !line.startsWith("##")) {
            const tagMatches = line.match(/#(\w+)/g);
            if (tagMatches) {
              tags = tagMatches.map(t => t.slice(1));
            }
          }
          // [Label] (single|multi) - label and select mode (but not [A], [B], etc.)
          else if (line.match(/^\[[^\]]{2,}\]/) || line.match(/^\[.+\].*\((single|multi)\)/)) {
            const labelMatch = line.match(/^\[([^\]]+)\]/);
            if (labelMatch) label = labelMatch[1];
            if (line.includes("(single)")) selectMode = "single";
            if (line.includes("(multi)")) selectMode = "multi";
          }
          // > **q1**: summary - linked parent
          else if (line.startsWith("> **")) {
            const match = line.match(/^> \*\*([^*]+)\*\*:\s*(.+)/);
            if (match) {
              parent_id = match[1];
              parent_summary = match[2];
            }
          }
          // **q2**: question text
          else if (line.startsWith("**") && line.includes("**:")) {
            const match = line.match(/^\*\*([^*]+)\*\*:\s*(.+)/);
            if (match) {
              id = match[1];
              text = match[2];
            }
          }
          // [A] option text
          else if (line.match(/^\[[A-Z]\]/)) {
            const match = line.match(/^\[([A-Z])\]\s*(.+)/);
            if (match) {
              options.push({ id: match[1], text: match[2] });
            }
          }
          // > description (for previous option)
          else if (line.startsWith(">") && options.length > 0) {
            const desc = line.slice(1).trim();
            if (desc) {
              options[options.length - 1].description = desc;
            }
          }
        }

        if (!text) {
          return new Response(JSON.stringify({ error: "Could not parse question" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const data = await loadConversation(conversationId);
        if (!id) id = "q" + (data.questions.length + 1);

        // Add [_] as last option if not already present
        if (!options.some(o => o.id === '_')) {
          options.push({ id: '_', text: '' });
        }

        data.questions.push({
          id,
          parent_id,
          parent_summary,
          label,
          tags,
          selectMode,
          text,
          options: options.map(opt => ({ ...opt, checked: false, seen: false })),
          created_at: Date.now(),
        });

        await saveConversation(conversationId, data);
        return new Response(JSON.stringify({ ok: true, id }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /api/conversation/:id/answers.md - get answers as markdown
      if (action === "answers.md" && req.method === "GET") {
        const data = await loadConversation(conversationId);
        let md = `# ${conversationId}\n\n`;

        for (const q of data.questions) {
          const checked = q.options.filter((o: any) => o.checked);
          if (checked.length === 0) continue;

          const label = q.label ? `${q.id} ${q.label}` : q.id;
          md += `**${label}**: ${q.text}\n`;

          for (const opt of checked) {
            const marker = opt.marker ? ` ${opt.marker}` : "";
            // Skip empty [_] options
            if (opt.id === "_" && !opt.text && !opt.description) continue;

            md += `- [${opt.id}]${marker} ${opt.text}\n`;
            if (opt.description) {
              const desc = opt.description.split('\n').map((l: string) => `  > ${l}`).join('\n');
              md += `${desc}\n`;
            }
          }
          md += "\n";
        }

        return new Response(md.trim() || "No answers yet.\n", {
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

        return new Response(JSON.stringify({ answers }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /api/conversation/:id/answers/new - get new answers since last check
      if (action === "answers/new" && req.method === "GET") {
        const data = await loadConversation(conversationId);
        const newAnswers = collectNewAnswers(data, true);
        await saveConversation(conversationId, data);

        return new Response(JSON.stringify({ answers: newAnswers }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET /api/conversation/:id/answers/wait - long-poll until new answers
      if (action === "answers/wait" && req.method === "GET") {
        const timeout = parseInt(url.searchParams.get("timeout") || "30000");
        const start = Date.now();

        while (Date.now() - start < timeout) {
          const data = await loadConversation(conversationId);
          const newAnswers = collectNewAnswers(data, false); // peek, don't mark seen yet

          if (newAnswers.length > 0) {
            // Now mark as seen
            collectNewAnswers(data, true);
            await saveConversation(conversationId, data);
            return new Response(JSON.stringify({ answers: newAnswers }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          await Bun.sleep(500); // poll interval
        }

        // Timeout - return empty
        return new Response(JSON.stringify({ answers: [], timeout: true }), {
          headers: { "Content-Type": "application/json" },
        });
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
