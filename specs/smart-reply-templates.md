# Spec: Smart Reply Templates

**Status**: Future plan
**Priority**: P3
**Depends on**: Email watcher daemon (`specs/email-watcher.md`)

## Summary

Pre-configured reply templates that the email watcher selects from based on email classification, instead of generating replies from scratch every time. Claude fills in template variables using context from the incoming email.

## Motivation

The email watcher (as currently specced) gives Claude a blank canvas for every email. This has three problems:

1. **Latency**: Generating a full reply from scratch takes 5-15s per email via Sonnet. Selecting a template and filling in 2-3 variables takes 2-5s.
2. **Consistency**: Free-form generation drifts in tone and structure. The user wants "their" voice, not a different style each time.
3. **Control**: Templates let the user pre-approve reply patterns. Instead of reviewing every draft word-by-word, they just check that the right template was picked and the variables are correct.

Templates do NOT replace free-form generation. They handle the ~70% of emails that follow predictable patterns (scheduling, acknowledgments, info requests, delegation). Unusual emails still get free-form treatment.

## How It Integrates with the Email Watcher

The watcher's Claude invocation (step 8 in `email-watcher.md`) changes from "draft a reply" to a two-phase process:

```
Phase 1: Classify + select template (or decide free-form)
Phase 2: Fill template variables OR generate free-form reply
```

Both phases happen in the same Claude invocation. The prompt changes to include the template library, and Claude is instructed to prefer templates when they fit.

### Modified prompt template

```
You just received a new email. Here are the details:

From: {from}
To: {to}
Date: {date}
Subject: {subject}
Thread ID: {thread_id}
Labels: {labels}

Body:
{body}

---

You have access to Gmail tools via MCP. You also have a library of reply templates below.

## Reply Templates

{templates_yaml}

## Instructions

1. Determine if this email needs a response. If not (FYI/notification/marketing), skip it.
2. If it needs a response, check if any template fits. A template "fits" if:
   - The email's category matches the template's `match` conditions
   - The template covers the core intent of the needed reply
3. If a template fits:
   - Select it by name
   - Extract the required variables from the email context
   - Fill the template and create a draft using create_draft with thread_id: "{thread_id}"
4. If no template fits, draft a free-form reply.

Prefer templates over free-form. Only go free-form for emails that genuinely don't match any template.
```

### Watcher code changes

The watcher script gains a new step before spawning Claude:

1. Load templates from the config directory
2. Serialize them as YAML into the prompt string
3. Pass the augmented prompt to Claude

This is a prompt-level integration, not a code-level one. Templates are injected as context. Claude does the selection and variable filling. No new MCP tools are needed.

## Template Format and Storage

### Storage location

```
~/.config/google-workspace-mcp/reply-templates.yaml
```

YAML over JSON for readability. Users will hand-edit these templates frequently. YAML handles multi-line strings cleanly with `|` block scalars.

### Template schema

```yaml
templates:
  - name: "meeting-scheduling"
    description: "Reply to propose or confirm meeting times"
    match:
      labels: ["[Superhuman]/AI/Meeting"]
      subject_contains: ["meeting", "sync", "catch up", "chat", "call", "1:1"]
    body: |
      Hi {sender_first_name},

      {response_body}

      Best,
      {my_first_name}
    variants:
      propose_times:
        description: "Propose available times when asked to meet"
        response_body: |
          Happy to meet. I'm generally available:
          - {time_slot_1}
          - {time_slot_2}
          - {time_slot_3}

          Let me know what works for you, or feel free to grab a slot on my calendar: {calendar_link}
      confirm:
        description: "Confirm a proposed time"
        response_body: "Sounds good, {proposed_time} works for me. Talk then."
      decline_reschedule:
        description: "Decline and suggest rescheduling"
        response_body: "Unfortunately I can't make {proposed_time}. Could we look at sometime {alternative_window} instead?"

  - name: "info-request"
    description: "Reply to someone asking for information or a document"
    match:
      subject_contains: ["question", "request", "can you send", "do you have"]
    body: |
      Hi {sender_first_name},

      {response_body}

      Best,
      {my_first_name}
    variants:
      will_send:
        description: "Acknowledge and promise to send the requested info"
        response_body: "Good question. Let me pull that together and get back to you by {timeframe}."
      have_answer:
        description: "Provide a direct answer inline"
        response_body: "{answer}"
      redirect:
        description: "Redirect to someone else who has the answer"
        response_body: "I think {redirect_person} would be the best person for this -- looping them in."

  - name: "follow-up"
    description: "Nudge someone who hasn't responded"
    match:
      labels: ["[Superhuman]/AI/Waiting"]
    body: |
      Hi {sender_first_name},

      Just following up on the below. {follow_up_detail}

      Thanks,
      {my_first_name}
    variants:
      gentle:
        description: "Soft check-in, no urgency"
        follow_up_detail: "No rush -- just wanted to make sure this didn't slip through the cracks."
      with_deadline:
        description: "Follow up with a deadline"
        follow_up_detail: "I need this by {deadline} to stay on track. Let me know if that's still doable."
      offer_help:
        description: "Follow up and offer to unblock"
        follow_up_detail: "If anything is blocking this on your end, happy to help move it along."

  - name: "delegation"
    description: "Delegate a task or request to someone else"
    match:
      labels: ["[Superhuman]/AI/Respond"]
    body: |
      Hi {delegate_name},

      {delegation_body}

      {original_context}

      Thanks,
      {my_first_name}
    variants:
      handoff:
        description: "Hand off a request entirely"
        delegation_body: "Could you take a look at the below? {reason_for_delegation}"
        original_context: "--- Forwarded ---\nFrom: {original_sender}\nSubject: {original_subject}\n\n{original_body_summary}"
      partial:
        description: "Ask for input on part of a request"
        delegation_body: "I'm working on a response to the below and could use your input on {specific_aspect}."
        original_context: "For context:\n{original_body_summary}"

  - name: "acknowledgment"
    description: "Simple acknowledgment -- no action required, just confirm receipt"
    match:
      labels: ["[Superhuman]/AI/Respond"]
      subject_contains: ["FYI", "heads up", "update", "announcement"]
    body: |
      {response_body}

      {my_first_name}
    variants:
      simple:
        description: "Bare acknowledgment"
        response_body: "Got it, thanks for the heads up."
      with_comment:
        description: "Acknowledge with a brief reaction"
        response_body: "Thanks for sharing. {brief_reaction}"
```

### Variable types

Variables in templates fall into three categories:

| Type | Examples | How Claude fills them |
|---|---|---|
| **Auto-resolved** | `{sender_first_name}`, `{my_first_name}`, `{original_subject}` | Extracted from email headers and user profile. No LLM reasoning needed. |
| **Context-extracted** | `{proposed_time}`, `{deadline}`, `{redirect_person}` | Claude reads the email body and extracts the relevant value. |
| **Generated** | `{answer}`, `{brief_reaction}`, `{reason_for_delegation}` | Claude generates a short phrase. Still constrained by template structure. |

Auto-resolved variables are documented in a `variables` block in the config:

```yaml
variables:
  my_first_name: "Max"
  calendar_link: "https://cal.com/max"
  default_timeframe: "end of day tomorrow"
```

## Template Selection Logic

Claude handles selection, but the watcher pre-filters to reduce prompt size:

### Pre-filtering (in watcher code)

1. Load all templates from `reply-templates.yaml`
2. For each template, check `match` conditions against the email:
   - `labels`: at least one label matches
   - `subject_contains`: at least one keyword appears in the subject (case-insensitive)
3. Include templates where ANY match condition is satisfied (OR logic across fields)
4. If no templates match, include ALL templates (let Claude decide)
5. Cap at 8 templates in the prompt to stay within token budget

### Selection (by Claude)

Claude picks the best template + variant, or goes free-form. The prompt instructs Claude to output its selection as a structured thought before calling `create_draft`:

```
Template: meeting-scheduling/propose_times
Variables: { sender_first_name: "Sarah", time_slot_1: "Tuesday 2-3pm", ... }
```

This makes it easy to review what happened in the watcher logs.

## Configuration

Templates live in `reply-templates.yaml`. Additional settings go in the existing `watcher-config.json`:

```json
{
  "templates": {
    "enabled": true,
    "path": "~/.config/google-workspace-mcp/reply-templates.yaml",
    "prefer_templates": true,
    "max_templates_in_prompt": 8,
    "free_form_fallback": true
  }
}
```

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch. When `false`, watcher uses the original free-form prompt. |
| `path` | `~/.config/.../reply-templates.yaml` | Path to template file. |
| `prefer_templates` | `true` | When `true`, prompt says "prefer templates." When `false`, says "use templates only if they're a strong fit." |
| `max_templates_in_prompt` | `8` | Max templates injected into the prompt after pre-filtering. |
| `free_form_fallback` | `true` | Allow Claude to draft free-form if no template fits. When `false`, Claude skips the email if no template matches. |

### Default templates

Ship a `reply-templates.default.yaml` in the repo. On first run, if the user's config directory has no `reply-templates.yaml`, copy the default file there. Never overwrite a user's existing file.

## Implementation Plan

### Phase 1: Template engine (no watcher changes)

**New files:**
- `src/templates/loader.ts` -- loads and validates `reply-templates.yaml` using a Zod schema
- `src/templates/matcher.ts` -- pre-filters templates against email metadata (labels, subject)
- `src/templates/serializer.ts` -- serializes matched templates to YAML string for prompt injection
- `reply-templates.default.yaml` -- default template library (the examples from this spec)

**Tests:**
- `tests/template-loader.test.ts` -- validates YAML parsing, schema validation, error handling for malformed files
- `tests/template-matcher.test.ts` -- tests pre-filter logic against various label/subject combos

### Phase 2: Watcher integration

**Modified files:**
- `scripts/email-watcher.ts` -- import template modules, load templates on startup, inject into prompt

**Changes:**
1. On startup: load templates from config, validate, warn on errors
2. Per email: run pre-filter, serialize matched templates, build augmented prompt
3. Pass augmented prompt to Claude invocation

### Phase 3: Polish

- First-run copy of `reply-templates.default.yaml` to config directory
- `npm run templates:validate` script to check template file for errors without running the watcher
- Add `templates` config section to `watcher-config.json` schema
- Documentation in CLAUDE.md

### Phase 4: Iteration (post-launch)

- Track which templates get used most (log template name + variant per email)
- Track which templates get edited by the user after drafting (signals bad fit)
- Add `exclude` match conditions (e.g., never use this template for emails from `@github.com`)
- Support per-account template overrides (different templates for work vs. personal)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Wrong template selected | Draft mismatches intent | Draft-only. User reviews. Log template selection for debugging. |
| Template file syntax errors | Watcher crashes on startup | Validate with Zod on load. Fall back to free-form if template file is invalid. |
| Too many templates bloat prompt | Higher latency and cost, context window pressure | Pre-filter + cap at 8. Templates are short (YAML is compact). |
| Users don't customize defaults | Generic-sounding replies | Defaults are deliberately minimal. `{my_first_name}` variable personalizes the basics. |
| Variable extraction fails | Template has unfilled `{placeholders}` | Claude is instructed to go free-form if it can't confidently fill all variables. |

## Out of Scope

- Template versioning or change history
- Web UI for editing templates
- A/B testing between template variants
- Templates for outbound (non-reply) emails
- Automatic template generation from past sent emails
