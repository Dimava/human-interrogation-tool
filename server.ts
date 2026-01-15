import { serve, file } from "bun";
import { mkdirSync } from "fs";

const DATA_DIR = "./data";
try { mkdirSync(DATA_DIR); } catch {}

// Emoji markers: \1-\5 rating, \x reset, \target tag
const MARKERS: Record<string, string> = {
  '\\1': '1️⃣',
  '\\2': '2️⃣',
  '\\3': '3️⃣',
  '\\4': '4️⃣',
  '\\5': '5️⃣',
  '\\x': '',
  '\\target': '🎯',
};

// --- Data helpers ---

const getDataFile = (id: string) => `${DATA_DIR}/${id}.json`;
const getMdFile = (id: string) => `${DATA_DIR}/${id}.md`;

async function load(id: string) {
  const f = file(getDataFile(id));
  return await f.exists() ? JSON.parse(await f.text()) : { questions: [], lastRead: null };
}

async function save(id: string, data: any) {
  await Bun.write(getDataFile(id), JSON.stringify(data, null, 2));
  await Bun.write(getMdFile(id), generateMarkdown(id, data));
}

function getStatus(data: any) {
  const pending: string[] = [], unread: string[] = [];
  for (const q of data.questions) {
    const checked = q.options.filter((o: any) => o.checked);
    if (checked.length === 0) pending.push(q.id);
    else if (checked.some((o: any) => !o.seen)) unread.push(q.id);
  }
  return { pending, unread };
}

// --- Markdown generation ---

function questionToMarkdown(q: any, answersOnly = false): string | null {
  const checked = q.options.filter((o: any) => o.checked);
  if (answersOnly && checked.length === 0) return null;

  let md = '';
  const tags = q.tags?.length ? q.tags.map((t: string) => `#${t}`).join(' ') + ' ' : '';
  const label = q.label ? `[${q.label}] ` : '';
  const mode = q.selectMode ? `(${q.selectMode}) ` : '';
  if (tags || label || mode) md += `${tags}${label}${mode}\n`;
  if (q.parent_id) md += `> **${q.parent_id}**: ${q.parent_summary || ''}\n`;
  md += `**${q.id}**: ${q.text}\n`;
  if (q.body) md += q.body + '\n';

  const opts = answersOnly ? checked : q.options;
  for (const opt of opts) {
    if (opt.id === '_' && !opt.text && !opt.description) continue;
    const marker = opt.marker ? ` ${opt.marker}` : '';
    if (answersOnly) md += `- [${opt.id}]${marker} ${opt.text}\n`;
    else md += `- [${opt.checked ? 'x' : ' '}] [${opt.id}]${marker} ${opt.text}\n`;
    if (opt.description) md += opt.description.split('\n').map((l: string) => `  > ${l}`).join('\n') + '\n';
  }
  return md;
}

function generateMarkdown(id: string, data: any, answersOnly = false, newOnly = false): string {
  const status = getStatus(data);
  let questions = data.questions;
  if (newOnly) {
    // Only include questions with unseen checked options
    questions = questions.filter((q: any) => q.options.some((o: any) => o.checked && !o.seen));
  }
  const parts = questions.map((q: any) => questionToMarkdown(q, answersOnly)).filter(Boolean);
  const frontmatter = `---\nconversation: ${id}\npending: [${status.pending.join(', ')}]\nunread: [${status.unread.join(', ')}]\n---\n\n`;
  return frontmatter + (parts.length ? `# ${id}\n\n${parts.join('\n')}` : (answersOnly ? 'No answers yet.\n' : `# ${id}\n`));
}

// --- Question parsing ---

function parseQuestion(chunk: string) {
  let parent_id: string | null = null, parent_summary: string | null = null;
  let id: string | null = null, text = "", label: string | null = null;
  let tags: string[] = [], selectMode: "single" | "multi" | null = null;
  let body: string[] = [];
  let inBody = false;
  const options: { id: string; text: string; description?: string }[] = [];

  for (const line of chunk.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#") && !t.startsWith("##")) {
      tags = (t.match(/#(\w+)/g) || []).map(x => x.slice(1));
    } else if (t.match(/^\[[^\]]{2,}\]/) || t.match(/^\[.+\].*\((single|multi)\)/)) {
      label = t.match(/^\[([^\]]+)\]/)?.[1] || null;
      if (t.includes("(single)")) selectMode = "single";
      if (t.includes("(multi)")) selectMode = "multi";
    } else if (t.startsWith("> **")) {
      const m = t.match(/^> \*\*([^*]+)\*\*:\s*(.+)/) as [string, string, string] | null;
      if (m) { parent_id = m[1]; parent_summary = m[2]; }
    } else if (t.startsWith("**") && t.includes("**:")) {
      const m = t.match(/^\*\*([^*]+)\*\*:\s*(.+)/) as [string, string, string] | null;
      if (m) { id = m[1]; text = m[2]; inBody = true; }
    } else if (t.match(/^\[[A-Z_]\]/)) {
      inBody = false;
      const m = t.match(/^\[([A-Z_])\]\s*(.*)/) as [string, string, string] | null;
      if (m) options.push({ id: m[1], text: m[2] });
    } else if (t.startsWith(">") && options.length > 0) {
      const desc = t.slice(1).trim();
      if (desc) options[options.length - 1]!.description = desc;
    } else if (inBody && t) {
      // Capture body lines between question and first option
      body.push(line);
    }
  }
  const bodyText = body.join("\n").trim() || null;
  return text ? { id, parent_id, parent_summary, label, tags, selectMode, text, body: bodyText, options } : null;
}

function collectNewAnswers(data: any, markSeen: boolean) {
  const newAnswers = [];
  for (const q of data.questions) {
    const newOpts = q.options.filter((o: any) => o.checked && !o.seen);
    if (newOpts.length > 0) {
      newAnswers.push({
        question_id: q.id, label: q.label, tags: q.tags, question_text: q.text,
        selected: newOpts.map((o: any) => ({ id: o.id, text: o.text, description: o.description, marker: o.marker })),
      });
      if (markSeen) q.options.forEach((o: any) => { if (o.checked) o.seen = true; });
    }
  }
  data.lastRead = Date.now();
  return newAnswers;
}

// --- Server ---

serve({
  port: 4242,
  idleTimeout: 0,
  routes: {
    "/": file("./index.html"),
    "/v/*": file("./index.html"),
    "/v1/*": file("./v/index-v1.html"),
    "/v2/*": file("./v/index-v2.html"),
    "/v3/*": file("./v/index-v3.html"),
    "/v4/*": file("./v/index-v4.html"),
    "/v5/*": file("./v/index-v5.html"),
    "/v6/*": file("./v/index-v6.html"),
    "/skill.md": file("./skill.md"),
    "/api.js": file("./api.js"),

    "/api/markers": {
      GET: () => Response.json(MARKERS),
    },

    "/api/conversation/:id/note": {
      async POST(req) {
        const id = req.params.id;
        let text = await req.text();
        let category = 'note';

        // Check for \category prefix (e.g., "\think something") - categorized notes also persist to ./notes/{category}.md
        const slashMatch = text.match(/^\\(\w+)\s+(.+)/s) as [string, string, string] | null;
        if (slashMatch) {
          category = slashMatch[1].toLowerCase();
          text = slashMatch[2];

          // Persist to ./notes/{category}.md
          try { mkdirSync('./notes'); } catch {}
          const notesFile = `./notes/${category}.md`;
          const existing = await file(notesFile).exists() ? await file(notesFile).text() : `# ${category}\n\n`;
          const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
          await Bun.write(notesFile, existing + `- [${timestamp}] [${id}] ${text}\n`);
        }

        const data = await load(id);
        if (!data.notes) data.notes = [];
        data.notes.push({ text, category, time: Date.now(), seen: false });
        await save(id, data);

        return Response.json({ ok: true, category });
      }
    },

    "/api/conversations": {
      async GET() {
        const { readdirSync, statSync } = await import("fs");
        const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
        const convos = files.map(f => {
          const id = f.replace('.json', '');
          const stat = statSync(`${DATA_DIR}/${f}`);
          return { id, modified: stat.mtimeMs };
        }).sort((a, b) => b.modified - a.modified);
        return Response.json(convos);
      }
    },

    "/api/conversation/:id/ask.md": {
      async POST(req) {
        const id = req.params.id;
        const md = await req.text();
        const chunks = md.split(/^---$/m).map(c => c.trim()).filter(Boolean);
        const data = await load(id);
        const ids: string[] = [];

        for (const chunk of chunks) {
          const parsed = parseQuestion(chunk);
          if (!parsed) continue;
          if (!parsed.id) parsed.id = "q" + (data.questions.length + 1);
          if (!parsed.options.some(o => o.id === '_')) parsed.options.push({ id: '_', text: '' });
          data.questions.push({ ...parsed, options: parsed.options.map(o => ({ ...o, checked: false, seen: false })), created_at: Date.now() });
          ids.push(parsed.id);
        }

        if (!ids.length) return Response.json({ error: "Could not parse any questions" }, { status: 400 });
        await save(id, data);
        return Response.json({ ok: true, ids, status: getStatus(data) });
      }
    },

    "/api/conversation/:id/wait.md": {
      async GET(req) {
        const id = req.params.id;
        const timeout = parseInt(new URL(req.url).searchParams.get("timeout") || "300000");
        const start = Date.now();

        while (Date.now() - start < timeout) {
          const data = await load(id);
          const hasNewAnswers = collectNewAnswers(data, false).length > 0;
          const unseenNotes = (data.notes || []).filter((n: any) => !n.seen);

          if (hasNewAnswers || unseenNotes.length > 0) {
            // Generate markdown BEFORE marking seen (so newOnly works)
            let md = generateMarkdown(id, data, true, true);
            if (unseenNotes.length > 0) {
              md += '\n## Notes\n\n' + unseenNotes.map((n: any) =>
                `> [${n.category || 'note'}] ${n.text}`
              ).join('\n\n') + '\n';
            }

            // Now mark as seen and save
            collectNewAnswers(data, true);
            unseenNotes.forEach((n: any) => n.seen = true);
            await save(id, data);

            return new Response(md);
          }
          await Bun.sleep(500);
        }
        return new Response(generateMarkdown(id, await load(id), true));
      }
    },

    "/api/conversation/:id/answers.md": {
      async GET(req) {
        return new Response(generateMarkdown(req.params.id, await load(req.params.id), true));
      }
    },

    "/api/conversation/:id/data": {
      async GET(req) { return Response.json(await load(req.params.id)); },
      async POST(req) { await save(req.params.id, await req.json()); return Response.json({ ok: true }); },
    },
  },
});

console.log("Server running at http://localhost:4242");
