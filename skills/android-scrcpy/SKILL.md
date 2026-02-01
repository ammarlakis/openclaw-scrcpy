---
name: android-scrcpy
description: Control a USB-connected Android device using adb + scrcpy via the android_scrcpy tool.
metadata: {"openclaw":{"os":["linux"],"requires":{"bins":["adb","scrcpy"]},"emoji":"🤖","homepage":"https://github.com/Genymobile/scrcpy"}}
---

# Android control (scrcpy + adb)

Use the `android_scrcpy` tool to safely control a USB-connected Android device.

## What you can do
- List connected devices
- Start/stop a `scrcpy` mirroring session (opens a desktop window)
- Send input: tap, swipe, text, key events
- Take a screenshot (returns an image or a saved file path)
- Open an allowlisted app / open a URL / wait
- Natural-language planning + execution (`action: "nl"`)

## Safety / constraints
- This is a **controlled wrapper**: it does not execute arbitrary shell commands.
- Device selection is via `serial` (adb device id). If omitted and exactly one device is connected, it will be used.
- Text input is length-limited and encoded to reduce shell metacharacter issues.
- Key events are restricted to a small allowlist of common Android KEYCODE_* values.
- `open_app` is restricted to an allowlist configured in the plugin config (`apps.allow`).
- `open_url` is restricted to http(s) URLs.
- `nl` is a controlled wrapper around a validated plan:
  - Only allows a fixed set of steps (tap/swipe/text/key/screenshot/open_app/open_url/wait)
  - Bounds-checkes coordinates using `adb shell wm size`
  - Defaults to **dry-run** (plan) and requires confirmation via `confirmToken` to execute (configurable)
  - Enforces max step count and a basic rate limit

## Tool: android_scrcpy

### List devices
Call:
```json
{ "action": "devices" }
```

### Start scrcpy
```json
{ "action": "scrcpy_start", "serial": "<adb-serial-optional>" }
```

### Stop scrcpy
```json
{ "action": "scrcpy_stop", "sessionId": "<from scrcpy_start>" }
```

### Tap / swipe
```json
{ "action": "tap", "serial": "<optional>", "x": 540, "y": 1600 }
```
```json
{ "action": "swipe", "serial": "<optional>", "x1": 540, "y1": 1600, "x2": 540, "y2": 400, "durationMs": 350 }
```

### Text / key
```json
{ "action": "text", "serial": "<optional>", "text": "hello world" }
```
```json
{ "action": "key", "serial": "<optional>", "keycode": "KEYCODE_HOME" }
```

### Screenshot
Return an image payload:
```json
{ "action": "screenshot", "serial": "<optional>", "as": "image" }
```
Or save to a file and return the path:
```json
{ "action": "screenshot", "serial": "<optional>", "as": "path" }
```

### Open an allowlisted app
```json
{ "action": "open_app", "serial": "<optional>", "app": "whatsapp" }
```

### Open a URL
```json
{ "action": "open_url", "serial": "<optional>", "url": "https://example.com" }
```

### Wait
```json
{ "action": "wait", "serial": "<optional>", "ms": 1200 }
```

### Natural-language (plan → execute)
Generate a plan:
```json
{ "action": "nl", "serial": "<optional>", "instruction": "Open WhatsApp, open the chat with Ammar, take a screenshot" }
```
Then execute (requires the `confirmToken` returned by the plan call when `nl.requireConfirmation=true`):
```json
{ "action": "nl", "serial": "<optional>", "mode": "execute", "confirmToken": "<token>", "instruction": "Open WhatsApp, open the chat with Ammar, take a screenshot" }
```

## Failure handling tips
- If planning fails: ensure the `llm-task` plugin is enabled/configured and that `apps.allow` includes the app(s) you want to open.
- If coordinate validation fails: run with scrcpy mirroring to determine screen coordinates, then re-run the instruction with explicit coordinates (e.g. “tap at x=…”).
- If execution stops mid-plan: rerun `nl` plan to generate a new plan for the current state.

## Telegram note
If you are using OpenClaw via Telegram, prefer `/skill android-scrcpy` rather than adding a dedicated Telegram slash command for this plugin. This avoids duplicated command namespaces and keeps skills portable across channels.
