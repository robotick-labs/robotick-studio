import type { RemoteControlState } from "./UseRemoteControlClient";

export type RemoteControlVector = {
  x: number;
  y: number;
};

export type RemoteControlButtonKey = Extract<
  keyof RemoteControlState,
  | "a"
  | "b"
  | "x"
  | "y"
  | "left_bumper"
  | "right_bumper"
  | "back"
  | "start"
  | "guide"
  | "left_stick_button"
  | "right_stick_button"
  | "dpad_up"
  | "dpad_down"
  | "dpad_left"
  | "dpad_right"
>;

export type RemoteControlStickName = "left" | "right";
export type RemoteControlTriggerName = "left" | "right";
export type RemoteControlShapeTransform = "None" | "CircleToSquare";

export type RemoteControlTargetBinding = {
  qualifiedPath: string;
  modelName: string;
  fieldPath: string;
};

export type RemoteControlStickMode = {
  id: string;
  label: string;
  shapeTransform: RemoteControlShapeTransform;
  deadZone: RemoteControlVector;
  scale: RemoteControlVector;
  outputs: Partial<Record<"x" | "y", RemoteControlTargetBinding>>;
};

export type RemoteControlStickConfig = {
  selectedMode: string;
  modes: Record<string, RemoteControlStickMode>;
};

export type RemoteControlTriggerMode = {
  id: string;
  label: string;
  deadZone: number;
  scale: number;
  bias: number;
  output: RemoteControlTargetBinding | null;
};

export type RemoteControlTriggerConfig = {
  selectedMode: string;
  modes: Record<string, RemoteControlTriggerMode>;
};

export type NormalizedRemoteControlsConfig = {
  sticks: Partial<Record<RemoteControlStickName, RemoteControlStickConfig>>;
  triggers: Partial<Record<RemoteControlTriggerName, RemoteControlTriggerConfig>>;
  buttons: Partial<Record<RemoteControlButtonKey, RemoteControlTargetBinding>>;
};

type RawStickModeConfig = {
  shapeTransform?: unknown;
  deadZone?: { x?: unknown; y?: unknown } | null;
  scale?: { x?: unknown; y?: unknown } | null;
  outputs?: { x?: unknown; y?: unknown } | null;
};

type RawTriggerModeConfig = {
  deadZone?: unknown;
  scale?: unknown;
  bias?: unknown;
  output?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function prettifyLabel(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function clampDeadZone(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(0.99, value));
}

function normalizeScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return value;
}

function normalizeShapeTransform(
  value: unknown
): RemoteControlShapeTransform {
  if (String(value ?? "").trim().toLowerCase() === "circletosquare") {
    return "CircleToSquare";
  }
  return "None";
}

export function parseTargetBinding(
  value: unknown
): RemoteControlTargetBinding | null {
  if (typeof value !== "string") {
    return null;
  }
  const qualifiedPath = value.trim();
  if (!qualifiedPath) {
    return null;
  }
  const splitIndex = qualifiedPath.indexOf(".");
  if (splitIndex <= 0 || splitIndex >= qualifiedPath.length - 1) {
    return null;
  }
  const modelName = qualifiedPath.slice(0, splitIndex);
  const fieldPath = qualifiedPath.slice(splitIndex + 1);
  if (!modelName || fieldPath.split(".").some((segment) => !segment)) {
    return null;
  }
  return {
    qualifiedPath,
    modelName,
    fieldPath,
  };
}

function normalizeStickMode(
  modeId: string,
  rawMode: RawStickModeConfig
): RemoteControlStickMode {
  const outputsRaw = isPlainObject(rawMode.outputs) ? rawMode.outputs : {};
  const outputs: RemoteControlStickMode["outputs"] = {};
  const xBinding = parseTargetBinding(outputsRaw.x);
  const yBinding = parseTargetBinding(outputsRaw.y);
  if (xBinding) {
    outputs.x = xBinding;
  }
  if (yBinding) {
    outputs.y = yBinding;
  }

  const deadZoneRaw = isPlainObject(rawMode.deadZone) ? rawMode.deadZone : {};
  const scaleRaw = isPlainObject(rawMode.scale) ? rawMode.scale : {};

  return {
    id: modeId,
    label: prettifyLabel(modeId),
    shapeTransform: normalizeShapeTransform(rawMode.shapeTransform),
    deadZone: {
      x: clampDeadZone(deadZoneRaw.x),
      y: clampDeadZone(deadZoneRaw.y),
    },
    scale: {
      x: normalizeScale(scaleRaw.x),
      y: normalizeScale(scaleRaw.y),
    },
    outputs,
  };
}

function normalizeStickConfig(
  rawStick: unknown
): RemoteControlStickConfig | null {
  if (!isPlainObject(rawStick)) {
    return null;
  }
  const rawModes = isPlainObject(rawStick.modes) ? rawStick.modes : {};
  const modeEntries = Object.entries(rawModes)
    .map(([modeId, rawMode]) => {
      if (!modeId.trim() || !isPlainObject(rawMode)) {
        return null;
      }
      return [modeId, normalizeStickMode(modeId, rawMode)] as const;
    })
    .filter((entry): entry is readonly [string, RemoteControlStickMode] => entry !== null);

  if (modeEntries.length === 0) {
    return null;
  }

  const modes = Object.fromEntries(modeEntries);
  const selectedModeRaw = String(rawStick.selectedMode ?? "").trim();
  const selectedMode =
    (selectedModeRaw && modes[selectedModeRaw] ? selectedModeRaw : null) ??
    modeEntries[0][0];

  return {
    selectedMode,
    modes,
  };
}

function normalizeTriggerMode(
  modeId: string,
  rawMode: RawTriggerModeConfig
): RemoteControlTriggerMode {
  return {
    id: modeId,
    label: prettifyLabel(modeId),
    deadZone: clampDeadZone(rawMode.deadZone),
    scale: normalizeScale(rawMode.scale),
    bias: typeof rawMode.bias === "number" && Number.isFinite(rawMode.bias)
      ? rawMode.bias
      : 0,
    output: parseTargetBinding(rawMode.output),
  };
}

function normalizeTriggerConfig(
  rawTrigger: unknown
): RemoteControlTriggerConfig | null {
  if (!isPlainObject(rawTrigger)) {
    return null;
  }
  const rawModes = isPlainObject(rawTrigger.modes) ? rawTrigger.modes : {};
  const modeEntries = Object.entries(rawModes)
    .map(([modeId, rawMode]) => {
      if (!modeId.trim() || !isPlainObject(rawMode)) {
        return null;
      }
      return [modeId, normalizeTriggerMode(modeId, rawMode)] as const;
    })
    .filter((entry): entry is readonly [string, RemoteControlTriggerMode] => entry !== null);

  if (modeEntries.length === 0) {
    return null;
  }

  const modes = Object.fromEntries(modeEntries);
  const selectedModeRaw = String(rawTrigger.selectedMode ?? "").trim();
  const selectedMode =
    (selectedModeRaw && modes[selectedModeRaw] ? selectedModeRaw : null) ??
    modeEntries[0][0];

  return {
    selectedMode,
    modes,
  };
}

export function normalizeRemoteControlsConfig(
  rawConfig: unknown
): NormalizedRemoteControlsConfig {
  const config = isPlainObject(rawConfig) ? rawConfig : {};
  const rawSticks = isPlainObject(config.sticks) ? config.sticks : {};
  const sticks: NormalizedRemoteControlsConfig["sticks"] = {};

  for (const stickName of ["left", "right"] as const) {
    const stickConfig = normalizeStickConfig(rawSticks[stickName]);
    if (stickConfig) {
      sticks[stickName] = stickConfig;
    }
  }

  const rawTriggers = isPlainObject(config.triggers) ? config.triggers : {};
  const triggers: NormalizedRemoteControlsConfig["triggers"] = {};

  for (const triggerName of ["left", "right"] as const) {
    const triggerConfig = normalizeTriggerConfig(rawTriggers[triggerName]);
    if (triggerConfig) {
      triggers[triggerName] = triggerConfig;
    }
  }

  const rawButtons = isPlainObject(config.buttons) ? config.buttons : {};
  const buttons: NormalizedRemoteControlsConfig["buttons"] = {};
  for (const [buttonKey, buttonTarget] of Object.entries(rawButtons)) {
    const normalizedKey = buttonKey.trim() as RemoteControlButtonKey;
    const binding = parseTargetBinding(buttonTarget);
    if (!binding) {
      continue;
    }
    buttons[normalizedKey] = binding;
  }

  return {
    sticks,
    triggers,
    buttons,
  };
}

export function applyShapeTransform(
  vector: RemoteControlVector,
  shapeTransform: RemoteControlShapeTransform
): RemoteControlVector {
  if (shapeTransform !== "CircleToSquare") {
    return { ...vector };
  }

  const radius = Math.hypot(vector.x, vector.y);
  const maxAxis = Math.max(Math.abs(vector.x), Math.abs(vector.y));
  if (radius <= 0 || maxAxis <= 0) {
    return { ...vector };
  }

  const scale = radius / maxAxis;
  return {
    x: vector.x * scale,
    y: vector.y * scale,
  };
}

export function applyDeadZone(value: number, deadZone: number): number {
  const normalizedDeadZone =
    typeof deadZone === "number" && Number.isFinite(deadZone)
      ? Math.max(0, Math.min(0.99, deadZone))
      : 0;
  const magnitude = Math.abs(value);
  if (magnitude <= normalizedDeadZone) {
    return 0;
  }
  const sign = Math.sign(value) || 1;
  return ((magnitude - normalizedDeadZone) / (1 - normalizedDeadZone)) * sign;
}

export function applyStickModeTransform(
  input: RemoteControlVector,
  mode: RemoteControlStickMode,
  options: { applyShapeTransform?: boolean } = {}
): RemoteControlVector {
  const shouldApplyShapeTransform = options.applyShapeTransform ?? true;
  const shaped = shouldApplyShapeTransform
    ? applyShapeTransform(input, mode.shapeTransform)
    : { ...input };
  const x = applyDeadZone(shaped.x, mode.deadZone.x) * mode.scale.x;
  const y = applyDeadZone(shaped.y, mode.deadZone.y) * mode.scale.y;
  return {
    x: Math.max(-1, Math.min(1, x)),
    y: Math.max(-1, Math.min(1, y)),
  };
}

export function applyTriggerModeTransform(
  input: number,
  mode: RemoteControlTriggerMode
): number {
  const normalizedInput =
    typeof input === "number" && Number.isFinite(input)
      ? Math.max(0, Math.min(1, input))
      : 0;
  const deadZoned = applyDeadZone(normalizedInput, mode.deadZone);
  const transformed = deadZoned * mode.scale + mode.bias;
  return Math.max(-1, Math.min(1, transformed));
}
