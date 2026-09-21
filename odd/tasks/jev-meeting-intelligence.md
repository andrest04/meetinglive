# Jev meeting intelligence

## Objective

Add TypeSafe Jev as an opt-in cloud judgment layer. Jev does not generate summaries. After a transcript/summary exists, code asks typed Choice/Score/Noul questions and the UI consumes probabilities.

## Problem

MeetingLive LLMs invent action items and claims. There is no structured check against the transcript. TypeSafe Jev is a hosted System One model (`POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`) that returns typed answers, not prose.

## Why

User authorized a TypeSafe API key in Settings (same DPAPI pattern as xAI). Cloud is required: Jev weights are not published; there is no GGUF/on-device runtime.

## Scope

In:

- HTTP client, DPAPI API-key store, Settings section, post-summary analysis, persist results, Summary UI badges, suggested folder (apply only on user confirm)
- Applicable Jev patterns only: verification, classification, scoring, routing, guardrails, value selection, confidence gates, parallel fan-out

Out:

- Jev as `ISummaryProvider` / transcript polisher
- Live streaming every partial transcript to TypeSafe
- Insurance/recruiting/ads cookbooks
- Changing the dirty `MicrophoneLevelMeterService.cs` file

## Constraints

- C#12, classic `[ObservableProperty]` private fields
- English UI strings in `Resources.resw` + `x:Uid`
- Secrets never in `settings.json` or logs
- Analysis is non-fatal: summary still saves if Jev fails
- Do not send transcript unless a key is saved and the enable toggle is on
- Tests: `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- Route: delegated direct

## Acceptance

- Paste/save/clear TypeSafe API key in Settings; key is DPAPI-protected
- After summary (Record pipeline and Summary page), one fan-out request verifies action items, classifies meeting type, scores urgency, flags PII, suggests a Library folder
- Uncertain/contradicted items are visible; Jev failure does not wipe the summary
- Core tests cover client, store, question composition, markdown round-trip

## Checks

- `dotnet test MeetingLive.Core.Tests/MeetingLive.Core.Tests.csproj`
- `dotnet build MeetingLive.App/MeetingLive.App.csproj -p:Platform=x64`

## Tasks

- [x] T1 HTTP client `TypeSafeApiClient` + exceptions + tests (`FakeHttpMessageHandler`)
- [x] T2 DPAPI credential store + `AppPaths.TypeSafeCredentialsFilePath`
- [x] T3 `MeetingJevAnalyzer` fan-out questions + compose answers in code
- [x] T4 Persist `MeetingJevAnalysis` on `MeetingRecord` via `## Jev` JSON section
- [x] T5 Settings section: enable toggle, PasswordBox, save/clear, connection test
- [x] T6 Wire after summary in `RecordingPipelineOrchestrator` and `SummaryPageViewModel`
- [x] T7 Summary UI: action-item verdicts, type, urgency, folder suggestion
- [x] T8 Core tests green; App x64 build

## Progress

2026-09-21: T1–T8 implemented on `feat/jev-meeting-intelligence`. `dotnet test MeetingLive.Core.Tests` 425 passed. App x64 build 0 errors. Not pushed.

## Next

Smoke: paste TypeSafe API key in Settings, generate a summary, confirm verdicts. User decides commit/push.
