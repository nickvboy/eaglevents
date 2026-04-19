"use client";

import type { HTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

type ParsedColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

type HsvColor = {
  h: number;
  s: number;
  v: number;
};

type HslColor = {
  h: number;
  s: number;
  l: number;
};

type ColorPickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  allowAlpha?: boolean;
  inputClassName?: string;
  panelClassName?: string;
};

export function ColorPicker({
  value,
  onChange,
  disabled = false,
  allowAlpha = false,
  inputClassName = "",
  panelClassName = "",
}: ColorPickerProps) {
  const fallbackValue = useMemo(
    () => normalizeHex(value, allowAlpha) ?? (allowAlpha ? "#000000ff" : "#000000"),
    [allowAlpha, value],
  );
  const parsedValue = useMemo(
    () => parseHexColor(fallbackValue) ?? parseHexColor(allowAlpha ? "#000000ff" : "#000000"),
    [allowAlpha, fallbackValue],
  );
  const currentHsv = useMemo(
    () => rgbToHsv(parsedValue?.r ?? 0, parsedValue?.g ?? 0, parsedValue?.b ?? 0),
    [parsedValue],
  );
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const [hue, setHue] = useState(currentHsv.h);
  const [saturation, setSaturation] = useState(currentHsv.s);
  const [brightness, setBrightness] = useState(currentHsv.v);
  const [alpha, setAlpha] = useState(Math.round((parsedValue?.a ?? 1) * 100));
  const [format, setFormat] = useState<"hsl" | "rgb" | "hex">("hsl");
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const squareRef = useRef<HTMLDivElement | null>(null);
  const formatMenuRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef(currentHsv.h);
  const textInputId = useId();

  useEffect(() => {
    hueRef.current = hue;
  }, [hue]);

  useEffect(() => {
    if (isOpen) return;
    setDraftValue(value);
    const normalized = normalizeHex(value, allowAlpha);
    const parsed = normalized ? parseHexColor(normalized) : null;
    if (!parsed) return;
    const hsv = rgbToHsvPreserveHue(parsed.r, parsed.g, parsed.b, hueRef.current);
    setHue(hsv.h);
    setSaturation(hsv.s);
    setBrightness(hsv.v);
    setAlpha(Math.round(parsed.a * 100));
  }, [allowAlpha, isOpen, value]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
      setFormatMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFormatMenuOpen(false);
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const applyHexValue = (nextValue: string) => {
    const normalized = normalizeHex(nextValue, allowAlpha);
    if (!normalized) return false;
    const parsed = parseHexColor(normalized);
    if (parsed) {
      const hsv = rgbToHsvPreserveHue(parsed.r, parsed.g, parsed.b, hueRef.current);
      setHue(hsv.h);
      setSaturation(hsv.s);
      setBrightness(hsv.v);
      setAlpha(Math.round(parsed.a * 100));
    }
    onChange(normalized);
    setDraftValue(normalized);
    return true;
  };

  const commitFromChannels = (
    nextHue: number,
    nextSaturation: number,
    nextBrightness: number,
    nextAlpha: number,
  ) => {
    setHue(nextHue);
    setSaturation(nextSaturation);
    setBrightness(nextBrightness);
    setAlpha(nextAlpha);
    const { r, g, b } = hsvToRgb(nextHue, nextSaturation, nextBrightness);
    const nextColor = formatHexColor(r, g, b, allowAlpha ? nextAlpha / 100 : 1, allowAlpha);
    onChange(nextColor);
    setDraftValue(nextColor);
  };

  const setColorFromRgb = (r: number, g: number, b: number, nextAlpha = alpha) => {
    const nextHsv = rgbToHsvPreserveHue(r, g, b, hueRef.current);
    setHue(nextHsv.h);
    setSaturation(nextHsv.s);
    setBrightness(nextHsv.v);
    setAlpha(nextAlpha);
    const nextColor = formatHexColor(r, g, b, allowAlpha ? nextAlpha / 100 : 1, allowAlpha);
    onChange(nextColor);
    setDraftValue(nextColor);
  };

  const setColorFromHsl = (nextHue: number, nextSaturation: number, nextLightness: number, nextAlpha = alpha) => {
    const nextHsv = hslToHsv(nextHue, nextSaturation, nextLightness, hueRef.current);
    setHue(nextHsv.h);
    setSaturation(nextHsv.s);
    setBrightness(nextHsv.v);
    setAlpha(nextAlpha);
    const nextRgb = hsvToRgb(nextHsv.h, nextHsv.s, nextHsv.v);
    const nextColor = formatHexColor(nextRgb.r, nextRgb.g, nextRgb.b, allowAlpha ? nextAlpha / 100 : 1, allowAlpha);
    onChange(nextColor);
    setDraftValue(nextColor);
  };

  const currentRgb = useMemo(() => hsvToRgb(hue, saturation, brightness), [hue, saturation, brightness]);
  const currentHsl = useMemo(() => hsvToHsl(hue, saturation, brightness), [hue, saturation, brightness]);
  const previewColor = formatHexColor(currentRgb.r, currentRgb.g, currentRgb.b, allowAlpha ? alpha / 100 : 1, allowAlpha);
  const hueRgb = hsvToRgb(hue, 100, 100);
  const hueColor = formatHexColor(hueRgb.r, hueRgb.g, hueRgb.b, 1, false);
  const alphaGradient = `linear-gradient(to right, ${formatRgbaColor(currentRgb.r, currentRgb.g, currentRgb.b, 0)}, ${formatRgbaColor(currentRgb.r, currentRgb.g, currentRgb.b, 1)})`;
  const formatFields = getFormatFields({
    format,
    allowAlpha,
    alpha,
    previewColor,
    parsedValue: { ...currentRgb, a: alpha / 100 },
    currentHsl,
    onHexChange: (nextValue) => {
      setDraftValue(nextValue);
      const normalized = normalizeHex(nextValue, allowAlpha);
      if (normalized) onChange(normalized);
    },
    onAlphaChange: (nextValue) => {
      const parsed = Number.parseInt(nextValue, 10);
      if (Number.isNaN(parsed)) return;
      const nextAlpha = clamp(parsed, 0, 100);
      setAlpha(nextAlpha);
      commitFromChannels(hue, saturation, brightness, nextAlpha);
    },
    onHslChange: (key, nextValue) => {
      const parsed = Number.parseInt(nextValue, 10);
      if (Number.isNaN(parsed)) return;
      if (key === "h") setColorFromHsl(clamp(parsed, 0, 360), currentHsl.s, currentHsl.l);
      if (key === "s") setColorFromHsl(currentHsl.h, clamp(parsed, 0, 100), currentHsl.l);
      if (key === "l") setColorFromHsl(currentHsl.h, currentHsl.s, clamp(parsed, 0, 100));
    },
    onRgbChange: (key, nextValue) => {
      const parsed = Number.parseInt(nextValue, 10);
      if (Number.isNaN(parsed)) return;
      if (key === "r") setColorFromRgb(clamp(parsed, 0, 255), parsedValue?.g ?? 0, parsedValue?.b ?? 0);
      if (key === "g") setColorFromRgb(parsedValue?.r ?? 0, clamp(parsed, 0, 255), parsedValue?.b ?? 0);
      if (key === "b") setColorFromRgb(parsedValue?.r ?? 0, parsedValue?.g ?? 0, clamp(parsed, 0, 255));
    },
  });

  const handleSquarePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;

    const updateFromPointer = (clientX: number, clientY: number) => {
      const rect = squareRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nextSaturation = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
      const nextBrightness = clamp(100 - ((clientY - rect.top) / rect.height) * 100, 0, 100);
      setSaturation(nextSaturation);
      setBrightness(nextBrightness);
      commitFromChannels(hue, nextSaturation, nextBrightness, alpha);
    };

    updateFromPointer(event.clientX, event.clientY);

    const handleMove = (moveEvent: PointerEvent) => updateFromPointer(moveEvent.clientX, moveEvent.clientY);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <button
        type="button"
        aria-label="Choose color"
        aria-expanded={isOpen}
        aria-controls={textInputId}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        className="group relative h-10 w-12 shrink-0 overflow-hidden rounded-xl border border-outline-muted bg-surface-raised transition hover:border-outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        style={checkerboardStyle()}
      >
        <span className="absolute inset-[3px] rounded-[10px]" style={{ backgroundColor: previewColor }} />
      </button>

      <input
        id={textInputId}
        value={draftValue}
        disabled={disabled}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraftValue(nextValue);
          const normalized = normalizeHex(nextValue, allowAlpha);
          if (normalized) onChange(normalized);
        }}
        onBlur={() => {
          if (!applyHexValue(draftValue)) setDraftValue(value);
        }}
        className={`min-w-[132px] flex-1 rounded-md border border-outline-muted bg-surface-raised px-3 py-2 text-sm text-ink-primary outline-none transition focus:border-outline-accent ${inputClassName}`.trim()}
        spellCheck={false}
      />

      {isOpen ? (
        <div
          className={`absolute left-0 top-full z-[10010] mt-2 w-[280px] rounded-[18px] border border-outline-muted bg-surface-raised/95 text-ink-primary shadow-2xl shadow-[var(--shadow-pane)] backdrop-blur ${panelClassName}`.trim()}
        >
          <div className="space-y-2">
            <div
              ref={squareRef}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label="Saturation and brightness"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(saturation)}
              onPointerDown={handleSquarePointer}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 10 : 2;
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  const next = clamp(saturation - step, 0, 100);
                  setSaturation(next);
                  commitFromChannels(hue, next, brightness, alpha);
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  const next = clamp(saturation + step, 0, 100);
                  setSaturation(next);
                  commitFromChannels(hue, next, brightness, alpha);
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  const next = clamp(brightness + step, 0, 100);
                  setBrightness(next);
                  commitFromChannels(hue, saturation, next, alpha);
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  const next = clamp(brightness - step, 0, 100);
                  setBrightness(next);
                  commitFromChannels(hue, saturation, next, alpha);
                }
              }}
              className="relative h-[168px] overflow-hidden border-b border-outline-muted bg-surface-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] outline-none focus-visible:border-outline-accent"
              style={{
                backgroundColor: hueColor,
                backgroundImage:
                  "linear-gradient(to top, #000 0%, transparent 100%), linear-gradient(to right, #fff 0%, rgba(255,255,255,0) 100%)",
              }}
            >
              <div
                className="pointer-events-none absolute h-4.5 w-4.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[var(--color-surface-raised)] shadow-[0_3px_10px_rgba(17,24,39,0.28)]"
                style={{
                  left: `${saturation}%`,
                  top: `${100 - brightness}%`,
                  backgroundColor: previewColor,
                }}
              />
            </div>

            <div className="space-y-2.5 px-2.5 py-2.5">
              <SliderControl
                value={hue}
                min={0}
                max={360}
                step={1}
                background="linear-gradient(to right, #ff3b30 0%, #ff9500 16%, #ffd60a 32%, #34c759 48%, #00c7be 64%, #0a84ff 80%, #bf5af2 100%)"
                accent={previewColor}
                leadingIcon={
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 20l4.3-1 9.8-9.8a2.1 2.1 0 10-3-3L5.3 16 4 20z" />
                    <path d="M13.5 5.5l5 5" />
                  </svg>
                }
                onChange={(nextHue) => {
                  setHue(nextHue);
                  commitFromChannels(nextHue, saturation, brightness, alpha);
                }}
              />

              {allowAlpha ? (
                <SliderControl
                  value={alpha}
                  min={0}
                  max={100}
                  step={1}
                  background={alphaGradient}
                  accent={previewColor}
                  checkerboard
                  onChange={(nextAlpha) => {
                    setAlpha(nextAlpha);
                    commitFromChannels(hue, saturation, brightness, nextAlpha);
                  }}
                />
              ) : null}

              <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-1.5">
                <div ref={formatMenuRef} className="relative">
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between rounded-lg border border-outline-muted bg-surface-raised px-2 text-[13px] font-medium text-ink-primary"
                    aria-haspopup="listbox"
                    aria-expanded={formatMenuOpen}
                    onClick={() => setFormatMenuOpen((open) => !open)}
                  >
                    <span>{format.toUpperCase()}</span>
                    <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink-subtle" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M5 7.5l5 5 5-5" />
                    </svg>
                  </button>
                  {formatMenuOpen ? (
                    <div className="absolute left-0 top-full z-[10020] mt-1 w-full rounded-lg border border-outline-muted bg-surface-raised p-1 shadow-xl shadow-[var(--shadow-pane)]">
                      {(["hsl", "rgb", "hex"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={
                            "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm transition " +
                            (format === option ? "bg-accent-muted text-ink-primary" : "text-ink-primary hover:bg-surface-muted")
                          }
                          onClick={() => {
                            setFormat(option);
                            setFormatMenuOpen(false);
                          }}
                        >
                          {option.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-outline-muted bg-surface-raised p-0.5">
                  <div className={`grid h-9 gap-0 overflow-hidden rounded-md ${formatFields.columns}`}>
                    {formatFields.fields.map((field, index) => (
                      <ValueInput
                        key={field.key}
                        value={field.value}
                        suffix={field.suffix}
                        inputMode={field.inputMode}
                        onChange={field.onChange}
                        compact
                        withDivider={index > 0}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type SliderControlProps = {
  value: number;
  min: number;
  max: number;
  step: number;
  background: string;
  accent: string;
  checkerboard?: boolean;
  leadingIcon?: ReactNode;
  onChange: (value: number) => void;
};

function SliderControl({
  value,
  min,
  max,
  step,
  background,
  accent,
  checkerboard = false,
  leadingIcon,
  onChange,
}: SliderControlProps) {
  const percent = ((value - min) / (max - min)) * 100;
  const checkerboardBackground = checkerboardStyle();

  return (
    <label className="grid gap-2">
      <div className="grid grid-cols-[18px_1fr] items-center gap-2">
        <span className="flex h-4 w-4 items-center justify-center text-ink-primary">{leadingIcon ?? null}</span>
        <div className="relative h-4 overflow-hidden rounded-full border border-outline-muted/70">
          {checkerboard ? <span className="absolute inset-0" style={checkerboardBackground} /> : null}
          <span className="absolute inset-0" style={{ background }} />
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
          />
          <span
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-[3px] border-[var(--color-surface-raised)] shadow-[0_3px_8px_rgba(17,24,39,0.2)]"
            style={{
              left: `calc(${percent}% - 8px)`,
              backgroundColor: accent,
            }}
          />
        </div>
      </div>
    </label>
  );
}

function ValueInput({
  value,
  onChange,
  suffix,
  inputMode,
  compact = false,
  withDivider = false,
}: {
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  compact?: boolean;
  withDivider?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <label
      className={
        "flex min-w-0 items-center gap-1 text-ink-primary " +
        (compact
          ? `h-full px-1.5 text-[11px] ${withDivider ? "border-l border-outline-muted" : ""}`
          : "rounded-lg border border-outline-muted bg-surface-raised px-2 py-2 text-sm")
      }
    >
      <input
        value={draft}
        inputMode={inputMode}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onChange(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onChange(draft);
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(value);
            (event.target as HTMLInputElement).blur();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-center font-semibold tabular-nums outline-none"
        spellCheck={false}
      />
      {suffix ? <span className="shrink-0 text-[9px] text-ink-subtle">{suffix}</span> : null}
    </label>
  );
}

function getFormatFields({
  format,
  allowAlpha,
  alpha,
  previewColor,
  parsedValue,
  currentHsl,
  onHexChange,
  onAlphaChange,
  onHslChange,
  onRgbChange,
}: {
  format: "hsl" | "rgb" | "hex";
  allowAlpha: boolean;
  alpha: number;
  previewColor: string;
  parsedValue: ParsedColor | null;
  currentHsl: HslColor;
  onHexChange: (value: string) => void;
  onAlphaChange: (value: string) => void;
  onHslChange: (key: "h" | "s" | "l", value: string) => void;
  onRgbChange: (key: "r" | "g" | "b", value: string) => void;
}) {
  if (format === "hex") {
    return {
      columns: allowAlpha ? "grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)]" : "grid-cols-1",
      fields: [
        { key: "hex", value: previewColor.toUpperCase(), onChange: onHexChange, inputMode: "text" as const },
        ...(allowAlpha
          ? [{ key: "alpha", value: `${alpha}`, suffix: "%", onChange: onAlphaChange, inputMode: "numeric" as const }]
          : []),
      ],
    };
  }

  if (format === "rgb") {
    return {
      columns: allowAlpha ? "grid-cols-4" : "grid-cols-3",
      fields: [
        { key: "r", value: `${Math.round(parsedValue?.r ?? 0)}`, onChange: (value: string) => onRgbChange("r", value), inputMode: "numeric" as const },
        { key: "g", value: `${Math.round(parsedValue?.g ?? 0)}`, onChange: (value: string) => onRgbChange("g", value), inputMode: "numeric" as const },
        { key: "b", value: `${Math.round(parsedValue?.b ?? 0)}`, onChange: (value: string) => onRgbChange("b", value), inputMode: "numeric" as const },
        ...(allowAlpha
          ? [{ key: "alpha", value: `${alpha}`, suffix: "%", onChange: onAlphaChange, inputMode: "numeric" as const }]
          : []),
      ],
    };
  }

  return {
    columns: allowAlpha ? "grid-cols-4" : "grid-cols-3",
    fields: [
      { key: "h", value: `${Math.round(currentHsl.h)}`, onChange: (value: string) => onHslChange("h", value), inputMode: "numeric" as const },
      { key: "s", value: `${Math.round(currentHsl.s)}`, suffix: "%", onChange: (value: string) => onHslChange("s", value), inputMode: "numeric" as const },
      { key: "l", value: `${Math.round(currentHsl.l)}`, suffix: "%", onChange: (value: string) => onHslChange("l", value), inputMode: "numeric" as const },
      ...(allowAlpha
        ? [{ key: "alpha", value: `${alpha}`, suffix: "%", onChange: onAlphaChange, inputMode: "numeric" as const }]
        : []),
    ],
  };
}

function normalizeHex(value: string, allowAlpha: boolean) {
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return null;

  const body = trimmed.slice(1);
  if (body.length === 3) {
    return `#${body
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`.toLowerCase();
  }

  if (body.length === 8 && !allowAlpha) {
    return `#${body.slice(0, 6).toLowerCase()}`;
  }

  return `#${body.toLowerCase()}`;
}

function parseHexColor(value: string): ParsedColor | null {
  const normalized = normalizeHex(value, true);
  if (!normalized) return null;
  const body = normalized.slice(1);
  const r = Number.parseInt(body.slice(0, 2), 16);
  const g = Number.parseInt(body.slice(2, 4), 16);
  const b = Number.parseInt(body.slice(4, 6), 16);
  const a = body.length === 8 ? Number.parseInt(body.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function formatHexColor(r: number, g: number, b: number, a: number, includeAlpha: boolean) {
  const channels = [r, g, b].map((channel) =>
    clamp(Math.round(channel), 0, 255)
      .toString(16)
      .padStart(2, "0"),
  );
  if (!includeAlpha) return `#${channels.join("")}`;
  const alphaChannel = clamp(Math.round(a * 255), 0, 255)
    .toString(16)
    .padStart(2, "0");
  return `#${channels.join("")}${alphaChannel}`;
}

function formatRgbaColor(r: number, g: number, b: number, a: number) {
  return `rgba(${clamp(Math.round(r), 0, 255)}, ${clamp(Math.round(g), 0, 255)}, ${clamp(Math.round(b), 0, 255)}, ${clamp(a, 0, 1)})`;
}

function rgbToHsv(r: number, g: number, b: number): HsvColor {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    switch (max) {
      case red:
        hue = ((green - blue) / delta) % 6;
        break;
      case green:
        hue = (blue - red) / delta + 2;
        break;
      default:
        hue = (red - green) / delta + 4;
        break;
    }
  }

  return {
    h: ((hue * 60) + 360) % 360,
    s: max === 0 ? 0 : (delta / max) * 100,
    v: max * 100,
  };
}

function rgbToHsvPreserveHue(r: number, g: number, b: number, fallbackHue: number): HsvColor {
  const next = rgbToHsv(r, g, b);
  if (next.s <= 0.0001 || next.v <= 0.0001) {
    return {
      ...next,
      h: fallbackHue,
    };
  }
  return next;
}

function hsvToRgb(h: number, s: number, v: number) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const value = clamp(v, 0, 100) / 100;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = value - chroma;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) {
    red = chroma;
    green = x;
  } else if (hue < 120) {
    red = x;
    green = chroma;
  } else if (hue < 180) {
    green = chroma;
    blue = x;
  } else if (hue < 240) {
    green = x;
    blue = chroma;
  } else if (hue < 300) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  return {
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255,
  };
}

function rgbToHsl(r: number, g: number, b: number): HslColor {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness * 100 };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;

  switch (max) {
    case red:
      hue = ((green - blue) / delta) % 6;
      break;
    case green:
      hue = (blue - red) / delta + 2;
      break;
    default:
      hue = (red - green) / delta + 4;
      break;
  }

  return {
    h: ((hue * 60) + 360) % 360,
    s: saturation * 100,
    l: lightness * 100,
  };
}

function hsvToHsl(h: number, s: number, v: number): HslColor {
  const saturation = clamp(s, 0, 100) / 100;
  const value = clamp(v, 0, 100) / 100;
  const lightness = value * (1 - saturation / 2);
  const nextSaturation =
    lightness === 0 || lightness === 1 ? 0 : (value - lightness) / Math.min(lightness, 1 - lightness);

  return {
    h,
    s: nextSaturation * 100,
    l: lightness * 100,
  };
}

function hslToHsv(h: number, s: number, l: number, fallbackHue: number): HsvColor {
  const hue = clamp(s, 0, 100) <= 0.0001 ? fallbackHue : ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const lightness = clamp(l, 0, 100) / 100;
  const value = lightness + saturation * Math.min(lightness, 1 - lightness);
  const nextSaturation = value === 0 ? 0 : 2 * (1 - lightness / value);

  return {
    h: hue,
    s: nextSaturation * 100,
    v: value * 100,
  };
}

function hslToRgb(h: number, s: number, l: number) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const lightness = clamp(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) {
    red = chroma;
    green = x;
  } else if (hue < 120) {
    red = x;
    green = chroma;
  } else if (hue < 180) {
    green = chroma;
    blue = x;
  } else if (hue < 240) {
    green = x;
    blue = chroma;
  } else if (hue < 300) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function checkerboardStyle() {
  return {
    backgroundColor: "rgba(148, 163, 184, 0.08)",
    backgroundImage:
      "linear-gradient(45deg, rgba(148, 163, 184, 0.18) 25%, transparent 25%, transparent 75%, rgba(148, 163, 184, 0.18) 75%), linear-gradient(45deg, rgba(148, 163, 184, 0.18) 25%, transparent 25%, transparent 75%, rgba(148, 163, 184, 0.18) 75%)",
    backgroundPosition: "0 0, 6px 6px",
    backgroundSize: "12px 12px",
  };
}
