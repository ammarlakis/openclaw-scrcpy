# openclaw-scrcpy

OpenClaw plugin to control a USB-connected Android device using **adb** + **scrcpy**.

- Plugin id: `android-scrcpy`
- Tool name: `android_scrcpy`

## Features

- List connected devices
- Start/stop a scrcpy mirroring session (desktop window)
- Send input via adb: tap / swipe / text / key
- Take screenshots (PNG)
- Optional **natural-language** planning + execution via a validated action plan (`action: "nl"`)

This plugin intentionally **does not** expose arbitrary shell execution.

## Requirements

### Host OS

- Linux is the primary supported host (tested)
- macOS / Windows may work if `adb` + `scrcpy` work, but are not CI-tested

### Binaries

You must have these installed and available on `PATH`:

- `adb` (Android platform-tools)
- `scrcpy`

## Install

Clone into your OpenClaw extensions directory.

Example (Linux):

```bash
mkdir -p ~/.openclaw/extensions
cd ~/.openclaw/extensions

git clone https://github.com/ammarlakis/openclaw-scrcpy.git android-scrcpy
```

Notes:
- The folder name should match the plugin id (`android-scrcpy`) to keep configuration and paths intuitive.

Restart OpenClaw:

```bash
openclaw gateway restart
```

## Configuration

Edit your OpenClaw config (typically `~/.openclaw/openclaw.json`):

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

          scrcpy: {
            noAudio: true,
            maxFps: 30,
            bitRate: "8M",
            windowTitle: "OpenClaw Android"
          },

          input: {
            maxTextLength: 256
          },

          // Allowlist apps for open_app + NL plans
          apps: {
            allow: {
              whatsapp: "com.whatsapp",
              chrome: "com.android.chrome"
            }
          },

          nl: {
            enabled: true,

            // Safe default: plan -> confirm -> execute
            requireConfirmation: true,

            // Trusted mode (less safe): plan+execute without confirm token
            // requireConfirmation: false,

            maxSteps: 20,
            minStepDelayMs: 250,
            maxStepsPerMinute: 60,

            // Optional override; otherwise llm-task defaults are used
            llmModel: ""
          }
        }
      }
    }
  }
}
```

### Allow the tool for your agent

The tool is registered as **optional** (opt-in). Add it to your agent allowlist:

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

## Natural-language mode (plan → confirm → execute)

Generate a plan (default):

```json
{ "action": "nl", "serial": "R58N...", "instruction": "Open WhatsApp, open the chat with Ammar, take a screenshot" }
```

Then execute the plan:

```json
{ "action": "nl", "serial": "R58N...", "mode": "execute", "confirmToken": "<token>", "instruction": "Open WhatsApp, open the chat with Ammar, take a screenshot" }
```

Notes:
- By default, execution requires a `confirmToken` from a previous plan call (`nl.requireConfirmation=true`).
- NL planning uses the **llm-task** plugin/tool (`llm_task`). Ensure `llm-task` is enabled and configured.

## Telegram usage (avoid command duplication)

If you are using OpenClaw via Telegram, prefer OpenClaw’s built-in skill routing instead of creating a custom `/android` command.

Use:

- `/skill android-scrcpy` to load the skill instructions
- then ask normally, and the agent can call `android_scrcpy` when allowed

This avoids duplicated command namespaces and keeps behaviour consistent across channels.

## Security

See [SECURITY.md](./SECURITY.md) for the threat model and safe defaults.

## License

MIT. See [LICENSE](./LICENSE).
