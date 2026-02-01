# android-scrcpy: NL commands test plan

## Prereqs
- `adb` and `scrcpy` installed on the host
- Android device connected via USB with USB debugging enabled
- OpenClaw gateway running
- Plugins enabled:
  - `android-scrcpy`
  - `llm-task` (required for `action: "nl"`)
- `android_scrcpy` tool allowlisted for your agent

## Config checklist
Add allowlisted apps:

```json5
plugins: {
  entries: {
    "android-scrcpy": {
      enabled: true,
      config: {
        apps: { allow: { whatsapp: "com.whatsapp" } },
        nl: { enabled: true, requireConfirmation: true }
      }
    },
    "llm-task": {
      enabled: true,
      config: {
        // allow at least one model key you have access to
        allowedModels: ["openai-codex/gpt-5.2"]
      }
    }
  }
}
```

## Manual test cases

### 1) Basic connectivity
- Call `{ "action": "devices" }` and confirm your device shows `state: device`.

### 2) Low-level primitives
- Tap Home (use key): `{ "action": "key", "keycode": "KEYCODE_HOME" }`
- Screenshot: `{ "action": "screenshot", "as": "path" }`

### 3) open_app allowlist
- `{ "action": "open_app", "app": "whatsapp" }` should launch WhatsApp.
- `{ "action": "open_app", "app": "com.some.random" }` should fail (not allowlisted).

### 4) NL plan
- `{ "action": "nl", "instruction": "Open WhatsApp and take a screenshot" }`
- Verify response includes:
  - `confirmToken`
  - `plan.steps[]` using only allowed actions

### 5) NL execute (confirmation required)
- Use the returned `confirmToken`:

```json
{ "action": "nl", "mode": "execute", "confirmToken": "<token>", "instruction": "Open WhatsApp and take a screenshot" }
```

- Verify:
  - steps execute
  - response includes screenshot output (path or image depending on plan)

### 6) Safety checks
- Try an instruction that would require an unknown app.
  - Expect planning/execution to fail with an allowlist error.
- Try an instruction that asks for a non-http URL.
  - Expect a validation error.

## Demo commands (copy/paste)

Plan:
```json
{ "action": "nl", "instruction": "Open WhatsApp, wait a second, take a screenshot" }
```

Execute:
```json
{ "action": "nl", "mode": "execute", "confirmToken": "<token>", "instruction": "Open WhatsApp, wait a second, take a screenshot" }
```
