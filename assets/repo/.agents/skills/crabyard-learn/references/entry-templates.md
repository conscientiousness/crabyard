# Entry Templates

Keep entries short and retrieval-friendly.

Use optional metadata only when it improves retrieval. Do not rewrite old notes solely to match this template.

## Knowledge

```md
---
title: <Title>
type: knowledge
kind: debugging | procedure | architecture-decision
summary: <One-line summary>
tags:
  - <tag>
aliases:
  - <natural-language query phrase>
concepts:
  - <durable concept>
paths:
  - <repo-relative/path.ts>
related_specs:
  - <repo-relative/spec.md>
related_changes:
  - <repo-relative/change>
supersedes: <old-note-or-path>
last_verified_at: YYYY-MM-DD
---

# <Title>

## Problem

## Signals

## Root Cause

## Fix

## Guardrails
```
