Every meeting, written down. Vozella records your microphone and your computer's audio with no bot in the call, transcribes on your PC, and writes the notes.

![The Vozella record screen](https://raw.githubusercontent.com/andrest04/vozella/main/docs/screenshots/record.png)

## Download

**[Download Vozella-Setup.exe](https://github.com/andrest04/vozella/releases/download/v{{VERSION}}/Vozella-Setup.exe)** for Windows x64.

This link is for version {{VERSION}}. [This one](https://github.com/andrest04/vozella/releases/latest/download/Vozella-Setup.exe) always serves the latest build.

## Install

1. Run `Vozella-Setup.exe`.
2. Windows may warn you, because this beta is not signed yet. Choose **More info**, then **Run anyway**.
3. To update, download the latest build and install it over this one. There are no automatic updates yet. Your meetings stay in `Documents\Vozella`.

## What's in the app

- **Records without a bot.** Your microphone plus all system audio or a single app. You can also import audio.
- **Transcribes.** A live preview while recording, then a final transcript from the recording.
- **Writes notes.** Summaries, action items and templates.
- **Helps during the call.** A live copilot window, detected questions and "What did I miss?".
- **Reminds you.** Calendar reminders, and a popup when a Zoom, Teams or Meet call is detected.
- **Keeps a library.** Folders, search, and chat scoped to a meeting, a folder or all meetings.

Transcription runs on your PC. Summaries and chat go to the engine you choose: local, Claude Code, Codex or Grok. See [where your data goes](https://github.com/andrest04/vozella#where-your-data-goes).

## What changed

{{CHANGES}}

## Verify the download

Compare the output of `Get-FileHash Vozella-Setup.exe -Algorithm SHA256` with `Vozella-Setup.exe.sha256`, attached below.
