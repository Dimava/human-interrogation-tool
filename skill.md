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

## Asking a Question

**POST** `/api/conversation/{id}/ask`

Send a markdown-formatted question:

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
curl -X POST http://localhost:4242/api/conversation/my-session/ask \
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

## Waiting for Answers

**GET** `/api/conversation/{id}/answers/wait?timeout=30000`

Long-polls until the human submits answers or timeout is reached.

```bash
curl "http://localhost:4242/api/conversation/my-session/answers/wait?timeout=60000"
```

### Response Format

```json
{
  "answers": [
    {
      "question_id": "q1",
      "label": "Architecture",
      "tags": ["design", "api"],
      "question_text": "Which database should we use?",
      "selected": [
        {
          "id": "A",
          "text": "PostgreSQL",
          "description": "Relational, ACID compliant...",
          "marker": null
        }
      ]
    }
  ]
}
```

If timeout occurs with no answers: `{"answers": [], "timeout": true}`

## Other Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/answers/new` | GET | Get new answers (marks as seen) |
| `/answers` | GET | Get all answered questions |
| `/answers.md` | GET | Get answers as markdown |
| `/data` | GET | Get full conversation data |
| `/data` | DELETE | Clear conversation |

## Recommended Workflow

1. **Ask**: POST your question to `/ask`
2. **Wait**: GET `/answers/wait?timeout=60000` to wait for response
3. **Process**: Parse the response and continue your task
4. **Repeat**: Ask follow-up questions as needed

## Tips

- Use descriptive `[Labels]` so humans understand context
- Add `#tags` for categorization
- Use `(single)` when only one answer makes sense
- Provide `> descriptions` for complex options
- Keep questions focused and specific
- Use meaningful question IDs like `**db-choice**:` for easier tracking

## Human Interface

The human answers at: `http://localhost:4242/conversation/{conversation_id}`

They can:
- Click options to select/deselect
- Edit option text for custom responses
- Use shortcuts like `\yes` `\no` for emoji markers
- Press Ctrl+Enter to send
