# Security

## Summary

This plugin controls a USB-connected Android device via `adb` (and optionally `scrcpy`).
Because `adb` input can perform sensitive actions on a device, **treat this plugin as privileged**.

## Threat model

### Assets
- Your Android device state (apps, accounts, messages, clipboard)
- Device UI interactions (taps, text input)
- Screenshots (may contain sensitive information)

### Attacker capabilities
- An attacker who can cause the agent to call tools (prompt injection / malicious instructions)
- A compromised LLM provider response
- A local attacker on the host machine with access to plugin files

### Non-goals
- Protecting against a fully compromised host OS.
- Protecting against a user who intentionally disables confirmations and allowlists.

## Safety mechanisms (current)

- No arbitrary shell execution: uses `spawn()` with fixed subcommands.
- `open_app` is restricted by an allowlist (`apps.allow`).
- `open_url` only allows `http`/`https` URLs.
- NL mode (`action: "nl"`) is mediated by a JSON plan:
  - Schema validated (TypeBox)
  - Coordinate bounds checks (based on `adb shell wm size`)
  - Step count limit (`nl.maxSteps`)
  - Rate limiting (`nl.maxStepsPerMinute`)
  - Optional confirmation-token flow (`nl.requireConfirmation`, default **true**)

## Recommended safe defaults

- Keep `nl.requireConfirmation=true` (default).
- Keep `apps.allow` minimal.
- Only allow the `android_scrcpy` tool for trusted agents.
- Avoid returning screenshot file paths to untrusted contexts.

## Reporting a vulnerability

If you find a vulnerability, please open a private report with the maintainer.
If private reporting is not possible, open a GitHub issue with minimal details and label it `security`.
