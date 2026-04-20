# Minitor rules

Cross-project coordination rules for projects that use Minitor as their multi-session runtime. Each rule lives in its own Markdown file with YAML frontmatter describing its `scope`, `status`, and `applies-to` tags. The frontmatter is machine-readable — `mmsg rules list` / `mmsg rules show <name>` parse it at runtime rather than copying the content anywhere, so there is only ever one source of truth per rule.

## Active rules

| Name | Scope | Updated | Summary |
|------|-------|---------|---------|
| [`multi-session-dispatch`](./multi-session-dispatch.md) | all-projects | 2026-04-20 | Type 1/2 topic patterns, 4-part user-facing report format, race handling, new-user onboarding checklist for multi-session coordination via `mmsg`. |

## Frontmatter schema

Each rule file starts with a YAML block like:

```yaml
---
name: <kebab-case-filename-without-extension>
scope: all-projects | single-project | experimental
status: active | draft | deprecated
created: YYYY-MM-DD
updated: YYYY-MM-DD
applies-to: [tag1, tag2, ...]   # e.g. [claude-code, mmsg-topic]
summary: One-line description used in CLI listings.
---
```

- **`name`** must match the filename (minus `.md`). This is what users pass to `mmsg rules show <name>`.
- **`scope`** signals where the rule is meant to apply. `all-projects` is the default; `single-project` is for rules tied to one specific repo (unusual — rules that specific usually belong in that repo's `CLAUDE.md`).
- **`status`** controls visibility: `active` shows up in `mmsg rules list` by default; `deprecated` is hidden unless `--all` is passed.
- **`applies-to`** is a free-form tag list for filtering (`mmsg rules list --tag claude-code`).
- **`summary`** is the one-liner shown in the list. Keep it under 120 chars.

## Referencing a rule from another project

Instead of hardcoding an absolute path in your project's `CLAUDE.md`, point at the CLI:

```markdown
### Cross-project coordination rules
See: `mmsg rules show multi-session-dispatch`
```

This way the rule is read from this repo wherever it's cloned, and updates here flow to every project without re-syncing.

## Adding a new rule

1. Create `docs/rules/<new-name>.md` with the frontmatter schema above.
2. Add a row to the **Active rules** table in this README.
3. Commit both changes together.

(There is no CI enforcement of the frontmatter — `mmsg rules list` will ignore files that don't parse cleanly. Keep the schema tidy.)
