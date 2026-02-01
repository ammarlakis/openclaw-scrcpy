# android-scrcpy (OpenClaw plugin)

Control a USB-connected Android device from OpenClaw using **adb** + **scrcpy**.

- Lists connected devices
- Starts/stops a scrcpy session (desktop window)
- Sends input via adb (tap/swipe/text/key)
- Takes screenshots (PNG)
- (NEW) Natural-language planning + execution via a validated action plan (`action: "nl"`)

This plugin intentionally **does not** expose arbitrary shell execution.

## Proposed plugin id

`android-scrcpy`

## Requirements

Linux host with:
- `adb` on PATH
- `scrcpy` on PATH
- Android device with USB debugging enabled

## Install (local dev in a workspace)

This repo places the plugin at:

```
<workspace>/.openclaw/extensions/android-scrcpy
```

OpenClaw auto-discovers plugins from:

- `<workspace>/.openclaw/extensions/*/index.ts`

### Enable in config

Edit `~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "android-scrcpy": {
        enabled: true,
        config: {
          adbPath: "adb",
          scrcpyPath: "scrcpy",
          defaultSerial: "",
          scrcpy: { noAudio: true, maxFps: 30, bitRate: "8M" },
          // Allowlist apps for `open_app` / `nl` plans
          apps: {
            allow: {
              whatsapp: "com.whatsapp",
              chrome: "com.android.chrome"
            }
          },
          nl: {
            enabled: true,
            requireConfirmation: true,
            maxSteps: 20,
            minStepDelayMs: 250,
            maxStepsPerMinute: 60,
            // optional override; otherwise llm-task defaults are used
            llmModel: ""
          }
        }
      }
    }
  }
}
```

Restart the gateway:

```bash
openclaw gateway restart
```

### Allow the tool

The tool is registered as **optional** (opt-in). Add to your agent allowlist:

```json5
{
  agents: {
    list: [
      {
        id: "rimaz",
        tools: {
          allow: ["android_scrcpy"]
        }
      }
    ]
  }
}
```

(You can also allow the whole plugin: `"android-scrcpy"`.)

## Usage

Tool name: `android_scrcpy`

### List devices
```json
{ "action": "devices" }
```

### Start scrcpy
```json
{ "action": "scrcpy_start", "serial": "R58N..." }
```

### Tap / swipe
```json
{ "action": "tap", "serial": "R58N...", "x": 500, "y": 1200 }
```

```json
{ "action": "swipe", "serial": "R58N...", "x1": 500, "y1": 1200, "x2": 500, "y2": 300, "durationMs": 350 }
```

### Text / key
```json
{ "action": "text", "serial": "R58N...", "text": "hello world" }
```

```json
{ "action": "key", "serial": "R58N...", "keycode": "KEYCODE_HOME" }
```

### Screenshot
```json
{ "action": "screenshot", "serial": "R58N...", "as": "image" }
```

### Open an app / open a URL / wait
```json
{ "action": "open_app", "serial": "R58N...", "app": "whatsapp" }
```
```json
{ "action": "open_url", "serial": "R58N...", "url": "https://example.com" }
```
```json
{ "action": "wait", "serial": "R58N...", "ms": 1200 }
```

### Natural-language (plan → confirm → execute)
First generate a plan (default):
```json
{ "action": "nl", "serial": "R58N...", "instruction": "Open WhatsApp, open the chat with Ammar, take a screenshot" }
```
The tool returns a JSON object containing a `confirmToken` and the structured `plan`.

Then execute the plan:
```json
{ "action": "nl", "serial": "R58N...", "mode": "execute", "confirmToken": "<token>", "instruction": "Open WhatsApp, open the chat with Ammar, take a screenshot" }
```

Notes:
- By default, execution requires a `confirmToken` from a previous plan call (`nl.requireConfirmation=true`).
- The planner is limited to a safe allowlist of actions and an app allowlist (`apps.allow`).
- Coordinates are bounds-checked using `adb shell wm size`.

## Implementation notes

- Uses `spawn()` (no shell) and a fixed set of adb/scrcpy subcommands.
- Maintains an in-memory session map for running scrcpy processes.
- On plugin stop, attempts to terminate any scrcpy sessions.
- `action: "nl"` uses the **llm-task** plugin (tool name: `llm_task`) to translate natural language into a JSON plan.
  - Ensure the `llm-task` plugin is enabled and configured with an allowed model.
  - No raw API keys are embedded in this plugin; it relies on OpenClaw’s model/provider configuration.

## Next steps (optional enhancements)

- Add `android_scrcpy_stream` using scrcpy `--record` or `--v4l2-sink` for frames.
- Add richer keycode allowlist or a config-controlled allowlist.
- Add UI coordinate normalization by querying display size (`adb shell wm size`).
- Add a dedicated `android_screenshot` tool returning both image + metadata.
