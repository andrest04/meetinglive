# Repo polish

## Objective

Finish the public face of the repository and the landing page.

## Problem and why

The repository is public but has no README, its `AGENTS.md` has stale facts, and the landing page has no favicon or sharing metadata.

## Scope

- GitHub About: description and topics. No homepage until a domain exists.
- `README.md` with verified facts and a real screenshot.
- Stale facts in `AGENTS.md`.
- `website/index.html`: favicon, sharing metadata, footer link to the repository.

## Constraints

- Every product claim must be traceable to the code.
- No licence file until the user chooses one.
- No private meeting data in screenshots.
- Internal names stay `MeetingLive`.

## Delivery

- Strategy: `ask-on-risk`. Forecast: under about 400 authored changed lines.
- Route: GitHub About inline; files delegated to one writer. Trigger: reading that prepares a write, across several files.

## Tasks

- [x] T1 Set the GitHub description and topics. Route: inline. Evidence: read back with `gh repo view`.
- [x] T2 Write `README.md`, fix `AGENTS.md`, and complete the landing page. Route: delegated. Evidence: the commit that adds this document.

## Checks

- Commands in the README match `AGENTS.md`.
- Relative links and images in the README resolve.
- The landing page renders, with no download wording.

## Progress

T1 and T2 done on `docs/repo-polish`. Links, commands and landing page text checked. README commands were not re-run, since nothing but docs changed.

## Next step

The user decides on merging and on a licence.
