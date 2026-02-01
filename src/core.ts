import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export type PluginApi = any;

export type AndroidScrcpyPluginConfig = {
  enabled?: boolean;
  adbPath?: string;
  scrcpyPath?: string;
  defaultSerial?: string;
  scrcpy?: {
    noAudio?: boolean;
    maxFps?: number;
    bitRate?: string;
    windowTitle?: string;
  };
  input?: {
    maxTextLength?: number;
  };
  apps?: {
    /** Allowlisted app names -> package names. Used by nl.open_app. */
    allow?: Record<string, string>;
  };
  nl?: {
    enabled?: boolean;
    /** When true (default), nl mode=execute requires a confirmToken from a prior plan call. */
    requireConfirmation?: boolean;
    /** Upper bound on number of steps a plan can contain. */
    maxSteps?: number;
    /** Minimum delay inserted between steps to avoid flooding input. */
    minStepDelayMs?: number;
    /** Max executed steps per minute per device serial (best-effort, local process memory). */
    maxStepsPerMinute?: number;
    /** LLM model key (provider/model). If omitted, uses llm-task defaults. */
    llmModel?: string;
  };
};

export function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function resolveCfg(raw: unknown): Required<AndroidScrcpyPluginConfig> {
  const cfg = isObj(raw) ? (raw as AndroidScrcpyPluginConfig) : {};
  return {
    enabled: cfg.enabled ?? true,
    adbPath: cfg.adbPath ?? "adb",
    scrcpyPath: cfg.scrcpyPath ?? "scrcpy",
    defaultSerial: cfg.defaultSerial ?? "",
    scrcpy: {
      noAudio: cfg.scrcpy?.noAudio ?? true,
      maxFps: cfg.scrcpy?.maxFps ?? 30,
      bitRate: cfg.scrcpy?.bitRate ?? "8M",
      windowTitle: cfg.scrcpy?.windowTitle ?? "OpenClaw Android",
    },
    input: {
      maxTextLength: cfg.input?.maxTextLength ?? 256,
    },
    apps: {
      allow: cfg.apps?.allow ?? {},
    },
    nl: {
      enabled: cfg.nl?.enabled ?? true,
      requireConfirmation: cfg.nl?.requireConfirmation ?? true,
      maxSteps: cfg.nl?.maxSteps ?? 20,
      minStepDelayMs: cfg.nl?.minStepDelayMs ?? 250,
      maxStepsPerMinute: cfg.nl?.maxStepsPerMinute ?? 60,
      llmModel: cfg.nl?.llmModel ?? "",
    },
  };
}

export function pickSerial(params: { serial?: string }, cfg: Required<AndroidScrcpyPluginConfig>, devices?: string[]) {
  const serial = (params.serial ?? cfg.defaultSerial ?? "").trim();
  if (serial) return serial;
  if (devices && devices.length === 1) return devices[0];
  return "";
}

export function parseAdbDevices(output: string): Array<{ serial: string; state: string; model?: string; device?: string }> {
  // adb devices -l output lines like:
  // R58N... device product:... model:Pixel_7 device:panther transport_id:1
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Array<{ serial: string; state: string; model?: string; device?: string }> = [];
  for (const line of lines) {
    if (line.startsWith("List of devices")) continue;
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1] ?? "";
    const rest = parts.slice(2);
    const kv = new Map<string, string>();
    for (const token of rest) {
      const i = token.indexOf(":");
      if (i > 0) kv.set(token.slice(0, i), token.slice(i + 1));
    }
    out.push({ serial, state, model: kv.get("model"), device: kv.get("device") });
  }
  return out;
}

export function encodeAdbInputText(text: string) {
  // adb shell input text requires spaces as %s and is fragile with shell metacharacters.
  // This encoding is conservative and avoids common breakage.
  return text
    .replace(/%/g, "%25")
    .replace(/\s/g, "%s")
    .replace(/&/g, "\\&")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/\|/g, "\\|")
    .replace(/;/g, "\\;")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\*/g, "\\*")
    .replace(/\?/g, "\\?")
    .replace(/\!/g, "\\!")
    .replace(/\"/g, "\\\"");
}

export const KeycodeSchema = Type.Union([
  Type.Literal("KEYCODE_HOME"),
  Type.Literal("KEYCODE_BACK"),
  Type.Literal("KEYCODE_APP_SWITCH"),
  Type.Literal("KEYCODE_ENTER"),
  Type.Literal("KEYCODE_DEL"),
  Type.Literal("KEYCODE_DPAD_UP"),
  Type.Literal("KEYCODE_DPAD_DOWN"),
  Type.Literal("KEYCODE_DPAD_LEFT"),
  Type.Literal("KEYCODE_DPAD_RIGHT"),
  Type.Literal("KEYCODE_DPAD_CENTER"),
  Type.Literal("KEYCODE_VOLUME_UP"),
  Type.Literal("KEYCODE_VOLUME_DOWN"),
  Type.Literal("KEYCODE_VOLUME_MUTE"),
  Type.Literal("KEYCODE_POWER"),
]);

export type Keycode = (typeof KeycodeSchema)["static"];

export const NLScreenshotSchema = Type.Optional(Type.Union([Type.Literal("image"), Type.Literal("path")]));

export const NLStepSchema = Type.Union([
  Type.Object({
    action: Type.Literal("tap"),
    x: Type.Integer({ minimum: 0 }),
    y: Type.Integer({ minimum: 0 }),
    comment: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("swipe"),
    x1: Type.Integer({ minimum: 0 }),
    y1: Type.Integer({ minimum: 0 }),
    x2: Type.Integer({ minimum: 0 }),
    y2: Type.Integer({ minimum: 0 }),
    durationMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 60_000 })),
    comment: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("text"),
    text: Type.String(),
    comment: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("key"),
    keycode: KeycodeSchema,
    comment: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("wait"),
    ms: Type.Integer({ minimum: 0, maximum: 60_000 }),
    comment: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("screenshot"),
    as: NLScreenshotSchema,
    comment: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("open_app"),
    /** Either a friendly allowlisted name (e.g. "whatsapp") or an allowlisted package name. */
    app: Type.String(),
    comment: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("open_url"),
    url: Type.String(),
    comment: Type.Optional(Type.String()),
  }),
]);

export type NLStep = (typeof NLStepSchema)["static"];

export const NLPlanSchema = Type.Object({
  version: Type.Literal(1),
  goal: Type.String(),
  steps: Type.Array(NLStepSchema, { minItems: 1 }),
});

export type NLPlan = (typeof NLPlanSchema)["static"];

export const ToolSchema = Type.Union([
  Type.Object({ action: Type.Literal("devices") }),
  Type.Object({ action: Type.Literal("scrcpy_start"), serial: Type.Optional(Type.String()) }),
  Type.Object({ action: Type.Literal("scrcpy_stop"), sessionId: Type.String() }),
  Type.Object({ action: Type.Literal("tap"), serial: Type.Optional(Type.String()), x: Type.Integer({ minimum: 0 }), y: Type.Integer({ minimum: 0 }) }),
  Type.Object({
    action: Type.Literal("swipe"),
    serial: Type.Optional(Type.String()),
    x1: Type.Integer({ minimum: 0 }),
    y1: Type.Integer({ minimum: 0 }),
    x2: Type.Integer({ minimum: 0 }),
    y2: Type.Integer({ minimum: 0 }),
    durationMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 60_000 })),
  }),
  Type.Object({ action: Type.Literal("text"), serial: Type.Optional(Type.String()), text: Type.String() }),
  Type.Object({ action: Type.Literal("key"), serial: Type.Optional(Type.String()), keycode: KeycodeSchema }),
  Type.Object({
    action: Type.Literal("screenshot"),
    serial: Type.Optional(Type.String()),
    as: Type.Optional(Type.Union([Type.Literal("image"), Type.Literal("path")])),
  }),
  Type.Object({ action: Type.Literal("open_app"), serial: Type.Optional(Type.String()), app: Type.String() }),
  Type.Object({ action: Type.Literal("open_url"), serial: Type.Optional(Type.String()), url: Type.String() }),
  Type.Object({ action: Type.Literal("wait"), serial: Type.Optional(Type.String()), ms: Type.Integer({ minimum: 0, maximum: 60_000 }) }),
  Type.Object({
    action: Type.Literal("nl"),
    serial: Type.Optional(Type.String()),
    instruction: Type.String({ minLength: 1, maxLength: 4000 }),
    mode: Type.Optional(Type.Union([Type.Literal("plan"), Type.Literal("execute")])),
    confirmToken: Type.Optional(Type.String()),
  }),
]);

export type ToolParams = (typeof ToolSchema)["static"];

export function safeUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function safeAndroidPackage(pkg: string) {
  // Conservative Android package name regex.
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(pkg);
}

export function ensureInBounds(pt: { x: number; y: number }, screen: { width: number; height: number }) {
  // Accept edges inclusive. adb input tap allows width/height (device dependent).
  if (pt.x < 0 || pt.y < 0 || pt.x > screen.width || pt.y > screen.height) {
    throw new Error(`Coordinates out of bounds (${pt.x}, ${pt.y}) for screen ${screen.width}x${screen.height}`);
  }
}

export function normalizeAppId(input: string) {
  return input.trim().toLowerCase();
}

export function resolveAllowedPackage(app: string, allow: Record<string, string>) {
  const key = normalizeAppId(app);
  // allow either friendly key or exact package match.
  if (allow[key]) return allow[key];
  if (safeAndroidPackage(app) && Object.values(allow).includes(app)) return app;
  return "";
}

export function validatePlan(plan: NLPlan, opts: { maxSteps: number; screen: { width: number; height: number }; cfg: Required<AndroidScrcpyPluginConfig> }) {
  if (plan.steps.length > opts.maxSteps) {
    throw new Error(`Plan too long (${plan.steps.length} steps). Max is ${opts.maxSteps}.`);
  }

  for (const [i, s] of plan.steps.entries()) {
    const stepNo = i + 1;
    switch (s.action) {
      case "tap":
        ensureInBounds({ x: s.x, y: s.y }, opts.screen);
        break;
      case "swipe":
        ensureInBounds({ x: s.x1, y: s.y1 }, opts.screen);
        ensureInBounds({ x: s.x2, y: s.y2 }, opts.screen);
        break;
      case "text":
        if (s.text.length > opts.cfg.input.maxTextLength) {
          throw new Error(`Step ${stepNo}: text too long (${s.text.length}). Max is ${opts.cfg.input.maxTextLength}.`);
        }
        break;
      case "key":
        // already schema-validated
        break;
      case "wait":
        // schema bounds ok
        break;
      case "screenshot":
        break;
      case "open_url":
        if (!safeUrl(s.url)) {
          throw new Error(`Step ${stepNo}: URL not allowed (must be http/https): ${s.url}`);
        }
        break;
      case "open_app": {
        const pkg = resolveAllowedPackage(s.app, opts.cfg.apps.allow);
        if (!pkg) {
          const allowed = Object.keys(opts.cfg.apps.allow);
          throw new Error(
            `Step ${stepNo}: app not allowlisted: ${s.app}. Configure plugins.entries["android-scrcpy"].config.apps.allow (keys: ${allowed.join(", ") || "(none)"}).`,
          );
        }
        break;
      }
      default:
        throw new Error(`Step ${stepNo}: unsupported action ${(s as any).action}`);
    }
  }
}

export function checkPlanSchema(parsed: unknown) {
  if (!Value.Check(NLPlanSchema, parsed)) {
    const errs = [...Value.Errors(NLPlanSchema, parsed)].slice(0, 5).map((e) => `${e.path}: ${e.message}`);
    throw new Error(`LLM plan failed schema validation: ${errs.join("; ")}`);
  }
  return parsed as NLPlan;
}
