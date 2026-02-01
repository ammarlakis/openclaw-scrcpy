import { Value } from "@sinclair/typebox/value";
import { spawn } from "node:child_process";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import {
  type Keycode,
  type NLPlan,
  type PluginApi,
  type ResolvedConfig,
  type ToolParams,
  ToolSchema,
  NLPlanSchema,
  checkPlanSchema,
  encodeAdbInputText,
  ensureInBounds,
  parseAdbDevices,
  pickSerial,
  resolveAllowedPackage,
  resolveCfg,
  safeUrl,
  validatePlan,
} from "./core.ts";

type ScrcpySession = {
  id: string;
  serial: string;
  startedAt: number;
  proc: ReturnType<typeof spawn>;
};

type CachedPlan = {
  token: string;
  createdAt: number;
  serial: string;
  instruction: string;
  plan: NLPlan;
  screen: { width: number; height: number };
};

async function run(bin: string, args: string[], opts?: { timeoutMs?: number }) {
  const timeoutMs = opts?.timeoutMs ?? 20_000;

  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${bin} ${args.join(" ")}`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function runBinOut(bin: string, args: string[], opts?: { timeoutMs?: number }) {
  const timeoutMs = opts?.timeoutMs ?? 20_000;

  return await new Promise<{ code: number; stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => chunks.push(d));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d) => (stderr += d));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${bin} ${args.join(" ")}`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(chunks), stderr });
    });
  });
}

async function getScreenSize(adbPath: string, serial: string) {
  // Prefer: adb shell wm size -> "Physical size: 1080x2400". Fallback to "Override size: ...".
  const res = await run(adbPath, ["-s", serial, "shell", "wm", "size"], { timeoutMs: 10_000 });
  if (res.code !== 0) throw new Error(`adb wm size failed: ${res.stderr || res.stdout}`);
  const m = res.stdout.match(/(Physical|Override)\s+size:\s*(\d+)x(\d+)/i) || res.stdout.match(/(\d+)x(\d+)/);
  if (!m) throw new Error(`Could not parse screen size from: ${res.stdout.trim()}`);
  const width = Number(m[m.length - 2]);
  const height = Number(m[m.length - 1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid screen size parsed: ${width}x${height}`);
  }
  return { width, height };
}

async function sleep(ms: number) {
  await new Promise<void>((r) => setTimeout(r, ms));
}

async function callToolBestEffort(api: PluginApi, toolName: string, params: any) {
  // The plugin host may expose a tool-calling facility. Probe common shapes.
  const candidates: Array<[string, any]> = [
    ["callTool", api.callTool],
    ["executeTool", api.executeTool],
    ["invokeTool", api.invokeTool],
    ["tools.execute", api.tools?.execute],
    ["tools.call", api.tools?.call],
  ];
  let lastErr: string = "";
  for (const [name, fn] of candidates) {
    if (typeof fn === "function") {
      try {
        return await fn.call(api.tools ?? api, toolName, params);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastErr = `api.${name}(${toolName}) failed: ${msg}`;
        // try next candidate
      }
    }
  }
  throw new Error(
    `Unable to call tool ${toolName}. ${lastErr || "No tool-calling API found on plugin host."} ` +
      `Enable the llm-task plugin and ensure the plugin host exposes a tool-call bridge to plugins.`,
  );
}

function extractFirstText(content: any): string {
  // OpenClaw tool results usually look like { content: [{type:'text', text:'...'}] }
  if (!content) return "";
  const c = content.content ?? content;
  if (Array.isArray(c)) {
    const t = c.find((x) => x?.type === "text" && typeof x.text === "string");
    return t?.text ?? "";
  }
  if (typeof c === "string") return c;
  return "";
}

async function llmPlanViaLlmTask(
  api: PluginApi,
  cfg: ResolvedConfig,
  opts: { instruction: string; screen: { width: number; height: number } },
) {
  const allowedApps = Object.entries(cfg.apps.allow).map(([k, v]) => `${k} => ${v}`);
  const system = "You are a STRICT JSON generator. Output must be a single JSON object matching the provided JSON Schema. No markdown, no prose.";

  const prompt = `Convert the user's instruction into a safe Android control plan.

Constraints:
- Only use these actions: tap, swipe, text, key, screenshot, open_app, open_url, wait.
- Coordinates must be within the device screen size.
- open_app must use ONLY allowlisted apps.
- open_url must be http(s) only.
- Keep steps minimal and add small waits when launching apps.

Device screen size:
- width: ${opts.screen.width}
- height: ${opts.screen.height}

Allowed apps (friendlyName => package):
${allowedApps.length ? allowedApps.join("\n") : "(none)"}

User instruction:
${opts.instruction}
`;

  const toolParams: any = {
    prompt,
    system,
    schema: NLPlanSchema,
    example: Value.Create(NLPlanSchema),
    jsonSchema: NLPlanSchema as any,
  };

  if (cfg.nl.llmModel) toolParams.model = cfg.nl.llmModel;

  const res = await callToolBestEffort(api, "llm_task", toolParams);
  const text = extractFirstText(res);
  if (!text) throw new Error("llm_task returned no text content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`llm_task did not return valid JSON. Raw: ${text.slice(0, 2000)}`);
  }

  return checkPlanSchema(parsed);
}

export default function register(api: PluginApi) {
  const sessions = new Map<string, ScrcpySession>();
  const cfg = resolveCfg(api.config?.plugins?.entries?.["android-scrcpy"]?.config);

  const planCache = new Map<string, CachedPlan>();
  const rate = new Map<string, number[]>();

  api.registerService?.({
    id: "android-scrcpy",
    start: () => {},
    stop: async () => {
      for (const s of sessions.values()) {
        try {
          s.proc.kill("SIGTERM");
        } catch {}
      }
      sessions.clear();
      planCache.clear();
      rate.clear();
    },
  });

  async function enforceRateLimit(serial: string) {
    const now = Date.now();
    const windowMs = 60_000;
    const max = cfg.nl.maxStepsPerMinute;
    const arr = rate.get(serial) ?? [];
    const recent = arr.filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      throw new Error(`Rate limit exceeded for ${serial}: ${recent.length}/${max} steps in the last minute.`);
    }
    recent.push(now);
    rate.set(serial, recent);
  }

  async function execTap(serial: string, x: number, y: number) {
    const res = await run(cfg.adbPath, ["-s", serial, "shell", "input", "tap", String(x), String(y)]);
    if (res.code !== 0) throw new Error(`adb tap failed: ${res.stderr || res.stdout}`);
  }

  async function execSwipe(serial: string, x1: number, y1: number, x2: number, y2: number, durationMs: number) {
    const res = await run(cfg.adbPath, [
      "-s",
      serial,
      "shell",
      "input",
      "swipe",
      String(x1),
      String(y1),
      String(x2),
      String(y2),
      String(durationMs),
    ]);
    if (res.code !== 0) throw new Error(`adb swipe failed: ${res.stderr || res.stdout}`);
  }

  async function execText(serial: string, text: string) {
    const maxLen = cfg.input.maxTextLength;
    if (text.length > maxLen) throw new Error(`Text too long (${text.length}). Max is ${maxLen}.`);
    const encoded = encodeAdbInputText(text);
    const res = await run(cfg.adbPath, ["-s", serial, "shell", "input", "text", encoded]);
    if (res.code !== 0) throw new Error(`adb text failed: ${res.stderr || res.stdout}`);
  }

  async function execKey(serial: string, keycode: Keycode) {
    const res = await run(cfg.adbPath, ["-s", serial, "shell", "input", "keyevent", keycode]);
    if (res.code !== 0) throw new Error(`adb keyevent failed: ${res.stderr || res.stdout}`);
  }

  async function execScreenshot(serial: string, mode: "image" | "path") {
    const { stdout, code, stderr } = await runBinOut(cfg.adbPath, ["-s", serial, "exec-out", "screencap", "-p"], {
      timeoutMs: 20_000,
    });
    if (code !== 0) throw new Error(`adb screenshot failed: ${stderr}`);

    if (mode === "path") {
      const outPath = path.join(os.tmpdir(), `openclaw-android-${serial}-${Date.now()}.png`);
      await fs.writeFile(outPath, stdout);
      return { mode: "path" as const, path: outPath };
    }

    return {
      mode: "image" as const,
      image: {
        data: stdout.toString("base64"),
        media_type: "image/png",
      },
    };
  }

  async function execOpenApp(serial: string, app: string) {
    const pkg = resolveAllowedPackage(app, cfg.apps.allow);
    if (!pkg) {
      const allowed = Object.keys(cfg.apps.allow);
      throw new Error(
        `App not allowlisted: ${app}. Configure plugins.entries["android-scrcpy"].config.apps.allow (keys: ${allowed.join(", ") || "(none)"}).`,
      );
    }
    const res = await run(cfg.adbPath, [
      "-s",
      serial,
      "shell",
      "monkey",
      "-p",
      pkg,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ]);
    if (res.code !== 0) throw new Error(`adb open_app failed: ${res.stderr || res.stdout}`);
  }

  async function execOpenUrl(serial: string, url: string) {
    if (!safeUrl(url)) throw new Error(`URL not allowed (must be http/https): ${url}`);
    const res = await run(cfg.adbPath, [
      "-s",
      serial,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      url,
    ]);
    if (res.code !== 0) throw new Error(`adb open_url failed: ${res.stderr || res.stdout}`);
  }

  api.registerTool(
    {
      name: "android_scrcpy",
      description:
        "Control a USB-connected Android device using a safe wrapper around adb + scrcpy. Supports listing devices, starting/stopping scrcpy, tap/swipe/text/key, screenshot, and (nl) natural-language planning/execution via a validated action plan.",
      parameters: ToolSchema,
      async execute(_id: string, params: ToolParams) {
        if (!cfg.enabled) {
          return { content: [{ type: "text", text: "android-scrcpy plugin is disabled." }] };
        }

        if (params.action === "devices") {
          const res = await run(cfg.adbPath, ["devices", "-l"], { timeoutMs: 10_000 });
          if (res.code !== 0) throw new Error(`adb devices failed: ${res.stderr || res.stdout}`);
          const devices = parseAdbDevices(res.stdout);
          return { content: [{ type: "text", text: JSON.stringify({ devices }, null, 2) }] };
        }

        // For actions that target a device, fetch the device list once to resolve default serial.
        const devRes = await run(cfg.adbPath, ["devices"], { timeoutMs: 10_000 });
        const connected = devRes.code === 0 ? parseAdbDevices(devRes.stdout).filter((d) => d.state === "device") : [];
        const connectedSerials = connected.map((d) => d.serial);

        if (params.action === "scrcpy_start") {
          const serial = pickSerial(params, cfg, connectedSerials);
          if (!serial) {
            throw new Error(
              `No device serial specified and could not infer one. Connected devices: ${connectedSerials.join(", ") || "(none)"}`,
            );
          }

          const sessionId = randomUUID();
          const args: string[] = [
            "--serial",
            serial,
            "--max-fps",
            String(cfg.scrcpy.maxFps),
            "--bit-rate",
            cfg.scrcpy.bitRate,
          ];
          if (cfg.scrcpy.noAudio) args.push("--no-audio");
          if (cfg.scrcpy.windowTitle) args.push("--window-title", cfg.scrcpy.windowTitle);

          const proc = spawn(cfg.scrcpyPath, args, { stdio: ["ignore", "pipe", "pipe"] });
          let stderr = "";
          proc.stderr?.setEncoding("utf8");
          proc.stderr?.on("data", (d) => (stderr += d));

          sessions.set(sessionId, { id: sessionId, serial, startedAt: Date.now(), proc });

          // If it immediately exits, surface the error.
          await sleep(250);
          if (proc.exitCode !== null) {
            sessions.delete(sessionId);
            throw new Error(`scrcpy exited immediately (code=${proc.exitCode}). ${stderr.trim()}`);
          }

          return { content: [{ type: "text", text: JSON.stringify({ ok: true, sessionId, serial, pid: proc.pid }, null, 2) }] };
        }

        if (params.action === "scrcpy_stop") {
          const s = sessions.get(params.sessionId);
          if (!s) return { content: [{ type: "text", text: `No such scrcpy session: ${params.sessionId}` }] };
          try {
            s.proc.kill("SIGTERM");
          } catch {}
          sessions.delete(params.sessionId);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, stopped: params.sessionId }, null, 2) }] };
        }

        const serial = pickSerial(params as any, cfg, connectedSerials);
        if (!serial) {
          throw new Error(
            `No device serial specified and could not infer one. Connected devices: ${connectedSerials.join(", ") || "(none)"}`,
          );
        }

        if (params.action === "tap") {
          await execTap(serial, params.x, params.y);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
        }

        if (params.action === "swipe") {
          await execSwipe(serial, params.x1, params.y1, params.x2, params.y2, params.durationMs ?? 300);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
        }

        if (params.action === "text") {
          await execText(serial, params.text);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
        }

        if (params.action === "key") {
          await execKey(serial, params.keycode);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
        }

        if (params.action === "wait") {
          await sleep(params.ms);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
        }

        if (params.action === "open_app") {
          await execOpenApp(serial, params.app);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
        }

        if (params.action === "open_url") {
          await execOpenUrl(serial, params.url);
          return { content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }] };
        }

        if (params.action === "screenshot") {
          const mode = params.as ?? "image";
          const out = await execScreenshot(serial, mode);
          if (out.mode === "path") return { content: [{ type: "text", text: JSON.stringify({ ok: true, path: out.path }, null, 2) }] };
          return { content: [{ type: "image", image: out.image }] };
        }

        if (params.action === "nl") {
          if (!cfg.nl.enabled) return { content: [{ type: "text", text: "android-scrcpy nl is disabled by config." }] };

          const mode = params.mode ?? "plan";
          const screen = await getScreenSize(cfg.adbPath, serial);

          if (mode === "plan") {
            const plan = await llmPlanViaLlmTask(api, cfg, { instruction: params.instruction, screen });
            validatePlan(plan, { maxSteps: cfg.nl.maxSteps, screen, cfg });

            const token = randomUUID();
            planCache.set(token, { token, createdAt: Date.now(), serial, instruction: params.instruction, plan, screen });

            if (planCache.size > 25) {
              const oldest = [...planCache.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
              if (oldest) planCache.delete(oldest.token);
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: true,
                      mode: "plan",
                      confirmToken: token,
                      serial,
                      screen,
                      plan,
                      note:
                        cfg.nl.requireConfirmation
                          ? "To execute, call {action:'nl', mode:'execute', confirmToken: <token>, instruction: <same or updated>}"
                          : "To execute, call {action:'nl', mode:'execute', instruction: ... }",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // mode=execute

          if (cfg.nl.requireConfirmation) {
            if (!params.confirmToken) {
              throw new Error(
                "nl execute requires confirmToken (run nl plan first). Set nl.requireConfirmation=false to bypass.",
              );
            }
            const cached = planCache.get(params.confirmToken);
            if (!cached) throw new Error(`Unknown or expired confirmToken: ${params.confirmToken}. Run nl plan again.`);
            if (cached.serial !== serial) {
              throw new Error(`confirmToken was created for serial ${cached.serial}, but requested serial is ${serial}.`);
            }

            // Re-validate against current screen size in case orientation changed.
            validatePlan(cached.plan, { maxSteps: cfg.nl.maxSteps, screen, cfg });

            const results: any[] = [];
            let lastImage: any | null = null;
            const screenshotPaths: string[] = [];

            for (const [i, step] of cached.plan.steps.entries()) {
              await enforceRateLimit(serial);
              if (cfg.nl.minStepDelayMs > 0) await sleep(cfg.nl.minStepDelayMs);

              try {
                switch (step.action) {
                  case "tap":
                    ensureInBounds({ x: step.x, y: step.y }, screen);
                    await execTap(serial, step.x, step.y);
                    results.push({ step: i + 1, action: step.action, ok: true });
                    break;
                  case "swipe":
                    ensureInBounds({ x: step.x1, y: step.y1 }, screen);
                    ensureInBounds({ x: step.x2, y: step.y2 }, screen);
                    await execSwipe(serial, step.x1, step.y1, step.x2, step.y2, step.durationMs ?? 300);
                    results.push({ step: i + 1, action: step.action, ok: true });
                    break;
                  case "text":
                    await execText(serial, step.text);
                    results.push({ step: i + 1, action: step.action, ok: true });
                    break;
                  case "key":
                    await execKey(serial, step.keycode);
                    results.push({ step: i + 1, action: step.action, ok: true });
                    break;
                  case "wait":
                    await sleep(step.ms);
                    results.push({ step: i + 1, action: step.action, ok: true });
                    break;
                  case "open_app":
                    await execOpenApp(serial, step.app);
                    results.push({ step: i + 1, action: step.action, ok: true });
                    break;
                  case "open_url":
                    await execOpenUrl(serial, step.url);
                    results.push({ step: i + 1, action: step.action, ok: true });
                    break;
                  case "screenshot": {
                    const as = step.as ?? "path";
                    const out = await execScreenshot(serial, as);
                    if (out.mode === "image") {
                      lastImage = out.image;
                      results.push({ step: i + 1, action: step.action, ok: true, as: "image" });
                    } else {
                      screenshotPaths.push(out.path);
                      results.push({ step: i + 1, action: step.action, ok: true, as: "path", path: out.path });
                    }
                    break;
                  }
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                throw new Error(`Step ${i + 1} failed (${step.action}): ${msg}`);
              }
            }

            const summary = { ok: true, mode: "execute", serial, steps: cached.plan.steps.length, results, screenshots: screenshotPaths };
            if (lastImage) {
              return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }, { type: "image", image: lastImage }] };
            }
            return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
          }

          // No confirmation required: plan+execute in one go.
          const plan = await llmPlanViaLlmTask(api, cfg, { instruction: params.instruction, screen });
          validatePlan(plan, { maxSteps: cfg.nl.maxSteps, screen, cfg });

          const results: any[] = [];
          let lastImage: any | null = null;
          const screenshotPaths: string[] = [];

          for (const [i, step] of plan.steps.entries()) {
            await enforceRateLimit(serial);
            if (cfg.nl.minStepDelayMs > 0) await sleep(cfg.nl.minStepDelayMs);

            try {
              switch (step.action) {
                case "tap":
                  ensureInBounds({ x: step.x, y: step.y }, screen);
                  await execTap(serial, step.x, step.y);
                  results.push({ step: i + 1, action: step.action, ok: true });
                  break;
                case "swipe":
                  ensureInBounds({ x: step.x1, y: step.y1 }, screen);
                  ensureInBounds({ x: step.x2, y: step.y2 }, screen);
                  await execSwipe(serial, step.x1, step.y1, step.x2, step.y2, step.durationMs ?? 300);
                  results.push({ step: i + 1, action: step.action, ok: true });
                  break;
                case "text":
                  await execText(serial, step.text);
                  results.push({ step: i + 1, action: step.action, ok: true });
                  break;
                case "key":
                  await execKey(serial, step.keycode);
                  results.push({ step: i + 1, action: step.action, ok: true });
                  break;
                case "wait":
                  await sleep(step.ms);
                  results.push({ step: i + 1, action: step.action, ok: true });
                  break;
                case "open_app":
                  await execOpenApp(serial, step.app);
                  results.push({ step: i + 1, action: step.action, ok: true });
                  break;
                case "open_url":
                  await execOpenUrl(serial, step.url);
                  results.push({ step: i + 1, action: step.action, ok: true });
                  break;
                case "screenshot": {
                  const as = step.as ?? "path";
                  const out = await execScreenshot(serial, as);
                  if (out.mode === "image") {
                    lastImage = out.image;
                    results.push({ step: i + 1, action: step.action, ok: true, as: "image" });
                  } else {
                    screenshotPaths.push(out.path);
                    results.push({ step: i + 1, action: step.action, ok: true, as: "path", path: out.path });
                  }
                  break;
                }
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              throw new Error(`Step ${i + 1} failed (${step.action}): ${msg}`);
            }
          }

          const summary = { ok: true, mode: "execute", serial, steps: plan.steps.length, results, screenshots: screenshotPaths };
          if (lastImage) return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }, { type: "image", image: lastImage }] };
          return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
        }

        return { content: [{ type: "text", text: "Unsupported action." }] };
      },
    },
    { optional: true },
  );
}
