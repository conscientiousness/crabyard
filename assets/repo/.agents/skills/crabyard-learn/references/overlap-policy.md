# Overlap Policy

## High overlap

Update the existing document when all of the following are true:

- the retrieval target is materially the same
- the new task adds detail rather than creating a distinct concept
- a second file would create ambiguity during future retrieval

## Moderate overlap

Prefer updating unless a new file would clearly improve retrieval by splitting:

- a different subsystem
- a different failure signature
- a different operator task

## Low overlap

Create a new focused file when the retrieval target is clearly distinct.

## Warning signs

- two files with nearly the same title
- index entries that point to multiple docs for the same question
- a new note that mostly restates an older one with only minor edits
