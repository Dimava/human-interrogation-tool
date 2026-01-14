# Human Interrogation Tool - LLM Skill

Use this tool to ask questions to a human and wait for their responses. This enables async human-in-the-loop workflows.

## When to Use

- You need human input, clarification, or approval
- A decision requires human judgment
- You want to present options and get feedback
- You need to gather preferences or requirements

## API Endpoint

Base URL: `http://localhost:4242/api/conversation/{conversation_id}`

Use a unique `conversation_id` per session (e.g., `session-123`, `project-review`).

## Asking Questions

**POST** `/api/conversation/{id}/ask.md`

Send markdown-formatted questions (3-10 per batch recommended):

```
#tag1 #tag2
[Label] (single|multi)
**q1**: Your question here?
[A] First option
    > Optional description explaining this choice
[B] Second option
    > More details about option B
[C] Third option
```

### Format Rules

| Element | Syntax | Required |
|---------|--------|----------|
| Tags | `#tag` | No |
| Label | `[Label]` | No |
| Mode | `(single)` or `(multi)` | No (defaults to multi) |
| Question ID | `**q1**:` | No (auto-generated if omitted) |
| Question text | After `**id**:` | Yes |
| Option | `[A] text` | Yes (at least one) |
| Description | `> text` on next line | No |

### Example Request

```bash
curl -X POST http://localhost:4242/api/conversation/my-session/ask.md \
  -H "Content-Type: text/plain" \
  -d '#design #api
[Architecture] (single)
**q1**: Which database should we use for this project?
[A] PostgreSQL
    > Relational, ACID compliant, good for complex queries
[B] MongoDB
    > Document store, flexible schema, good for rapid iteration
[C] SQLite
    > Embedded, zero config, good for small projects'
```

### Multiple Questions

Separate questions with `---` to batch them in a single request:

```
**q1**: First question?
[A] Option A
[B] Option B
---
**q2**: Second question?
[A] Yes
[B] No
---
#priority
[Urgency] (single)
**q3**: How urgent is this?
[A] High
[B] Medium
[C] Low
```

Response includes status:
```json
{
  "ok": true,
  "ids": ["q1", "q2", "q3"],
  "status": { "pending": ["q1", "q2", "q3"], "unread": [] }
}
```

## Waiting for Answers

**GET** `/api/conversation/{id}/wait.md`

Long-polls until answers arrive. Default timeout: 5 minutes.

```bash
curl "http://localhost:4242/api/conversation/my-session/wait.md"
```

Returns answers with YAML frontmatter:

```yaml
---
conversation: my-session
pending: [q2, q3]
unread: []
---

# my-session

**q1**: Which database?
- [A] PostgreSQL
```

If `pending` is not empty, wait again.

## Other Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ask.md` | POST | Add questions |
| `/wait.md` | GET | Long-poll for answers |
| `/answers.md` | GET | All answers (no wait) |

## Workflow

1. **Ask**: POST 3-10 questions to `/ask.md`
2. **Wait**: GET `/wait.md` (5 min default)
3. **Check**: If `pending` not empty, wait again
4. **Repeat**: Ask follow-ups based on answers

## Tips

- **Batch wisely**: 3-10 questions per request; too few wastes round-trips, too many overwhelms
- Use `[Labels]` so humans understand context
- Use `(single)` when only one answer makes sense
- Provide `> descriptions` for complex options

## Human Interface

The human answers at: `http://localhost:4242/v/{conversation_id}`

They can:
- Click options to select/deselect
- Edit option text for custom responses
- Use shortcuts like `\yes` `\no` for emoji markers
- Press Ctrl+Enter to send
