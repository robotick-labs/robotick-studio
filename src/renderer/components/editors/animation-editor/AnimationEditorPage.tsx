import React from "react";
import { useProjectContext } from "../../../data-sources/launcher/internal/ProjectContext";
import { buildProjectAssetUrl } from "../../../data-sources/launcher/internal/launcher-interface";
import styles from "./AnimationEditorPage.module.css";

type Point = { t: number; v: number };
type ClipRef = { name: string; animclipPath: string };
type ClipData = { name: string; channels: Record<string, Point[]>; durationSec: number };
type LaneRange = { min: number; max: number };

const DEFAULT_ANIMSET = "content/animsets/barr_e_expression_mvp.animset.yaml";
const TOOL_SECTIONS = [
  { title: "Brushes", items: ["Draw", "Smooth", "Flatten", "Push/Pull"] },
  { title: "Range", items: ["Scale", "Offset", "Ramp Up", "Ramp Down"] },
  { title: "Timing", items: ["Snap to 0.1s", "Hold Keys", "Mirror Range"] },
];

function parseAnimsetYaml(yaml: string): ClipRef[] {
  const clips: ClipRef[] = [];
  const lines = yaml.split(/\r?\n/);
  let pendingName = "";
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("- name:")) {
      pendingName = t.slice("- name:".length).trim().replace(/^['"]|['"]$/g, "");
      continue;
    }
    if (t.startsWith("animclip_path:")) {
      const p = t.slice("animclip_path:".length).trim().replace(/^['"]|['"]$/g, "");
      if (p) clips.push({ name: pendingName || p.split("/").pop() || "clip", animclipPath: p });
      pendingName = "";
    }
  }
  return clips;
}

function parseAnimclipYaml(yaml: string): ClipData {
  const lines = yaml.split(/\r?\n/);
  let clipName = "clip";
  const channels: Record<string, Point[]> = {};
  let currentChannel = "";
  let pendingTime: number | null = null;
  let maxT = 0;
  for (const raw of lines) {
    const t = raw.trim();
    if (t.startsWith("name:")) {
      clipName = t.slice("name:".length).trim().replace(/^['"]|['"]$/g, "") || clipName;
      continue;
    }
    if (t.startsWith("- channel:")) {
      currentChannel = t.slice("- channel:".length).trim().replace(/^['"]|['"]$/g, "");
      if (!channels[currentChannel]) channels[currentChannel] = [];
      pendingTime = null;
      continue;
    }
    if (t.startsWith("time_sec:")) {
      const tv = Number(t.slice("time_sec:".length).trim());
      pendingTime = Number.isFinite(tv) ? tv : null;
      continue;
    }
    if (t.startsWith("value:") && currentChannel) {
      const vv = Number(t.slice("value:".length).trim());
      if (!Number.isFinite(vv)) continue;
      const time = pendingTime ?? (channels[currentChannel].length * (1 / 60));
      channels[currentChannel].push({ t: time, v: vv });
      if (time > maxT) maxT = time;
    }
  }
  return { name: clipName, channels, durationSec: Math.max(0.01, maxT) };
}

function curvePath(points: Point[], durationSec: number, width: number, height: number, minV: number, maxV: number) {
  if (!points.length || durationSec <= 0) return "";
  const span = Math.max(1e-6, maxV - minV);
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = (p.t / durationSec) * width;
    const y = height - ((p.v - minV) / span) * height;
    d += `${i === 0 ? "M" : " L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

function fitRangeWithPadding(points: Point[]): LaneRange {
  if (!points.length) return { min: -1, max: 1 };
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const span = Math.max(1e-6, max - min);
  const pad = span * 0.12;
  const rawMin = min - pad;
  const rawMax = max + pad;

  const roughStep = Math.max(1e-6, (rawMax - rawMin) / 6);
  const exponent = Math.floor(Math.log10(roughStep));
  const base = Math.pow(10, exponent);
  const fraction = roughStep / base;
  let niceFraction = 1;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  const step = niceFraction * base;

  const quantMin = Math.floor(rawMin / step) * step;
  const quantMax = Math.ceil(rawMax / step) * step;
  if (quantMax - quantMin < 1e-6) {
    return { min: quantMin - step, max: quantMax + step };
  }
  return { min: quantMin, max: quantMax };
}

export default function AnimationEditorPage() {
  const { projectPath } = useProjectContext();
  const [playhead, setPlayhead] = React.useState(280);
  const [isPlaying, setIsPlaying] = React.useState(true);
  const [animsetPath, setAnimsetPath] = React.useState(DEFAULT_ANIMSET);
  const [clipRefs, setClipRefs] = React.useState<ClipRef[]>([]);
  const [selectedClipPath, setSelectedClipPath] = React.useState("");
  const [clipData, setClipData] = React.useState<ClipData>({ name: "clip", channels: {}, durationSec: 10 });
  const [channelVisible, setChannelVisible] = React.useState<Record<string, boolean>>({});
  const [channelColor, setChannelColor] = React.useState<Record<string, string>>({});
  const [hoveredChannel, setHoveredChannel] = React.useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = React.useState<string | null>(null);
  const [laneRange, setLaneRange] = React.useState<Record<string, LaneRange>>({});
  const timelineRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function loadAnimset() {
      if (!projectPath) return;
      const url = buildProjectAssetUrl(projectPath, animsetPath);
      const text = await (await fetch(url)).text();
      const parsed = parseAnimsetYaml(text);
      if (cancelled) return;
      setClipRefs(parsed);
      if (parsed.length > 0) setSelectedClipPath(parsed[0].animclipPath);
    }
    void loadAnimset();
    return () => {
      cancelled = true;
    };
  }, [projectPath, animsetPath]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadClip() {
      if (!projectPath || !selectedClipPath) return;
      const url = buildProjectAssetUrl(projectPath, selectedClipPath);
      const text = await (await fetch(url)).text();
      const parsed = parseAnimclipYaml(text);
      if (cancelled) return;
      setClipData(parsed);
      setPlayhead((p) => Math.min(p, 1000));
      const names = Object.keys(parsed.channels);
      setChannelVisible((prev) => {
        const next: Record<string, boolean> = {};
        names.forEach((n) => (next[n] = prev[n] ?? true));
        return next;
      });
      setChannelColor((prev) => {
        const palette = ["#77ceff", "#7ef9a9", "#ffd166", "#ff7b72", "#d9a3ff", "#7afcff", "#fcbf49", "#f07167"];
        const next: Record<string, string> = {};
        names.forEach((n, i) => (next[n] = prev[n] ?? palette[i % palette.length]));
        return next;
      });
      setLaneRange(() => {
        const next: Record<string, LaneRange> = {};
        names.forEach((n) => {
          next[n] = fitRangeWithPadding(parsed.channels[n] ?? []);
        });
        return next;
      });
      setSelectedChannel((prev) => (prev && names.includes(prev) ? prev : names[0] ?? null));
    }
    void loadClip();
    return () => {
      cancelled = true;
    };
  }, [projectPath, selectedClipPath]);

  const channelNames = Object.keys(clipData.channels);
  const visibleChannels = channelNames.filter((n) => channelVisible[n] !== false);
  const allChannelsVisible = channelNames.length > 0 && visibleChannels.length === channelNames.length;
  const durationSec = Math.max(0.01, clipData.durationSec);
  const playheadSec = (playhead / 1000) * durationSec;

  function seekFromClientX(clientX: number) {
    const element = timelineRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    setPlayhead(Math.round(ratio * 1000));
  }

  function beginPlayheadDrag(event: React.PointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    seekFromClientX(event.clientX);
    const onMove = (moveEvent: PointerEvent) => seekFromClientX(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function formatAxisValue(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 100) return value.toFixed(0);
    if (abs >= 10) return value.toFixed(1);
    if (abs >= 1) return value.toFixed(2);
    return value.toFixed(3);
  }

  return (
    <div className={styles.root} data-testid="animation-editor-panel">
      <div className={styles.mainGrid}>
        <aside className={styles.sidebar}>
          <section className={styles.panelCard}>
            <h3>AnimSet</h3>
            <select value={animsetPath} onChange={(e) => setAnimsetPath(e.target.value)} className={styles.selectControl}>
              <option value="content/animsets/barr_e_expression_mvp.animset.yaml">
                barr_e_expression_mvp.animset.yaml
              </option>
            </select>
            <h3>Clip</h3>
            <select
              value={selectedClipPath}
              onChange={(e) => setSelectedClipPath(e.target.value)}
              className={styles.selectControl}
            >
              {clipRefs.map((c) => (
                <option key={c.animclipPath} value={c.animclipPath}>
                  {c.name}
                </option>
              ))}
            </select>
          </section>
          <section className={styles.panelCard}>
            <div className={styles.channelsHeader}>
              <h3>Channels</h3>
              <button
                className={styles.eyeToggle}
                type="button"
                title={allChannelsVisible ? "Hide all channels" : "Show all channels"}
                aria-label={allChannelsVisible ? "Hide all channels" : "Show all channels"}
                onClick={() =>
                  setChannelVisible((prev) => {
                    const next: Record<string, boolean> = { ...prev };
                    for (const name of channelNames) {
                      next[name] = !allChannelsVisible;
                    }
                    return next;
                  })
                }
              >
                {allChannelsVisible ? "👁" : "◌"}
              </button>
            </div>
            <ul className={styles.list}>
              {channelNames.map((channel) => (
                <li
                  key={channel}
                  className={[
                    styles.channelKeyRow,
                    hoveredChannel === channel ? styles.channelKeyRowHovered : "",
                    selectedChannel === channel ? styles.channelKeyRowSelected : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setHoveredChannel(channel)}
                  onMouseLeave={() => setHoveredChannel((prev) => (prev === channel ? null : prev))}
                  onClick={() => setSelectedChannel(channel)}
                >
                  <input
                    type="color"
                    value={channelColor[channel] ?? "#77ceff"}
                    onChange={(e) => setChannelColor((p) => ({ ...p, [channel]: e.target.value }))}
                    title="Set channel color"
                  />
                  <span>{channel}</span>
                  <button
                    className={styles.eyeToggle}
                    type="button"
                    title={channelVisible[channel] !== false ? "Hide channel" : "Show channel"}
                    aria-label={channelVisible[channel] !== false ? "Hide channel" : "Show channel"}
                    onClick={() =>
                      setChannelVisible((p) => ({
                        ...p,
                        [channel]: p[channel] === false,
                      }))
                    }
                  >
                    {channelVisible[channel] !== false ? "👁" : "◌"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main className={styles.timelineArea}>
          <section className={styles.timelineHeader}>
            <h2>{clipData.name || "clip"}</h2>
            <div className={styles.metaLine}>Mode: AnimDriven</div>
          </section>

          <section ref={timelineRef} className={styles.timelineCanvas} aria-label="Animation timeline">
            <div className={styles.timeRuler}>
              <span className={styles.rulerMark}>0.0s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.2).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.4).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.6).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{(durationSec * 0.8).toFixed(1)}s</span>
              <span className={styles.rulerMark}>{durationSec.toFixed(1)}s</span>
              <div className={styles.rulerPlayheadHandle} style={{ left: `${playhead / 10}%` }}>
                <button className={styles.rulerHandleGrip} type="button" onPointerDown={beginPlayheadDrag} />
              </div>
            </div>
            <div className={styles.lanes}>
              {visibleChannels.map((channel) => {
                const points = clipData.channels[channel] ?? [];
                const range = laneRange[channel] ?? fitRangeWithPadding(points);
                const minV = range.min;
                const maxV = range.max;
                return (
                  <div
                    key={channel}
                    className={[
                      styles.laneRow,
                      hoveredChannel === channel ? styles.laneRowHovered : "",
                      selectedChannel === channel ? styles.laneRowSelected : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseEnter={() => setHoveredChannel(channel)}
                    onMouseLeave={() => setHoveredChannel((prev) => (prev === channel ? null : prev))}
                    onClick={() => setSelectedChannel(channel)}
                  >
                    <div className={styles.laneAxis}>
                      <input
                        className={styles.laneAxisInput}
                        value={formatAxisValue(maxV)}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value)) return;
                          setLaneRange((prev) => {
                            const current = prev[channel] ?? { min: minV, max: maxV };
                            if (value <= current.min) return prev;
                            return { ...prev, [channel]: { ...current, max: value } };
                          });
                        }}
                        title="Channel Y max"
                      />
                      <input
                        className={styles.laneAxisInput}
                        value={formatAxisValue(minV)}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value)) return;
                          setLaneRange((prev) => {
                            const current = prev[channel] ?? { min: minV, max: maxV };
                            if (value >= current.max) return prev;
                            return { ...prev, [channel]: { ...current, min: value } };
                          });
                        }}
                        title="Channel Y min"
                      />
                    </div>
                    <div className={styles.laneTrack}>
                      <button
                        className={styles.laneFitButton}
                        type="button"
                        title="Fit Y for this channel"
                        onClick={() =>
                          setLaneRange((prev) => ({
                            ...prev,
                            [channel]: fitRangeWithPadding(points),
                          }))
                        }
                      >
                        Fit Y
                      </button>
                      <svg className={styles.laneSvg} viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
                        <path
                          d={curvePath(points, durationSec, 1000, 34, minV, maxV)}
                          className={styles.laneCurve}
                          style={{ stroke: channelColor[channel] ?? "#77ceff" }}
                        />
                      </svg>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={styles.playhead} style={{ left: `${playhead / 10}%` }} />
          </section>
        </main>

        <aside className={styles.tools}>
          {TOOL_SECTIONS.map((section) => (
            <section key={section.title} className={styles.panelCard}>
              <h3>{section.title}</h3>
              <div className={styles.toolButtons}>
                {section.items.map((item) => (
                  <button key={item} className={styles.toolButton} type="button">
                    {item}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>
      </div>

      <footer className={styles.transportBar}>
        <div className={styles.transportLeft}>
          <button className={styles.transportChipButton} type="button">
            Loop: On
          </button>
          <button className={styles.transportChipButton} type="button">
            Save Clip
          </button>
        </div>
        <div className={styles.transportCenter}>
          <div className={styles.transportCluster} role="group" aria-label="Playback controls">
            <button className={`${styles.transportIconButton} ${styles.iconStop}`} type="button" aria-label="Stop">
              ⏹
            </button>
            <button
              className={`${styles.transportIconButton} ${styles.iconPlayPause}`}
              type="button"
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={() => setIsPlaying((value) => !value)}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button className={`${styles.transportIconButton} ${styles.iconRecord}`} type="button" aria-label="Record">
              ●
            </button>
          </div>
          <div className={styles.transportNumericGroup}>
            <label className={styles.transportNumericField}>
              Playhead
              <input
                type="number"
                min={0}
                max={durationSec}
                step={0.01}
                value={playheadSec.toFixed(2)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  const clamped = Math.min(durationSec, Math.max(0, value));
                  setPlayhead(Math.round((clamped / durationSec) * 1000));
                }}
              />
            </label>
            <span className={styles.transportSlash}>/</span>
            <label className={styles.transportNumericField}>
              Duration
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={durationSec.toFixed(2)}
                readOnly
              />
            </label>
          </div>
        </div>
        <div className={styles.transportRight} />
      </footer>
    </div>
  );
}
