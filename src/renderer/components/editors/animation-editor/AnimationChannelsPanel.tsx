import React from "react";

import styles from "./AnimationEditorPage.module.css";

function MonitorPassThroughIcon() {
  return (
    <svg
      className={styles.monitorToggleIcon}
      viewBox="0 0 16 12"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.5 6C2.4 6 2.8 4 3.8 4S5.2 8 6.2 8" />
      <path d="M9.8 4C10.8 4 11.2 8 12.2 8S13.6 6 14.5 6" />
      <path d="M8 1.5V10.5" />
    </svg>
  );
}

type AnimationChannelsPanelProps = {
  allChannelsArmed: boolean;
  allChannelsMonitored: boolean;
  allChannelsVisible: boolean;
  channelColor: Record<string, string>;
  channelNames: string[];
  channelVisible: Record<string, boolean>;
  hoveredChannel: string | null;
  monitorByChannel: Record<string, boolean>;
  onToggleAllMonitor: () => void;
  onToggleAllRecordArm: () => void;
  onToggleChannelMonitor: (channel: string) => void;
  onToggleChannelRecordArm: (channel: string) => void;
  recordArmByChannel: Record<string, boolean>;
  selectedChannel: string | null;
  setChannelColor: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setChannelVisible: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setHoveredChannel: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedChannel: React.Dispatch<React.SetStateAction<string | null>>;
};

export function AnimationChannelsPanel({
  allChannelsArmed,
  allChannelsMonitored,
  allChannelsVisible,
  channelColor,
  channelNames,
  channelVisible,
  hoveredChannel,
  monitorByChannel,
  onToggleAllMonitor,
  onToggleAllRecordArm,
  onToggleChannelMonitor,
  onToggleChannelRecordArm,
  recordArmByChannel,
  selectedChannel,
  setChannelColor,
  setChannelVisible,
  setHoveredChannel,
  setSelectedChannel,
}: AnimationChannelsPanelProps) {
  return (
    <section className={styles.panelCard}>
      <div className={styles.channelsHeader}>
        <h3>Channels</h3>
        <button
          className={`${styles.monitorToggle} ${allChannelsMonitored ? styles.monitorToggleActive : ""}`}
          type="button"
          title={allChannelsMonitored ? "Disable monitor on all channels." : "Enable monitor on all channels."}
          aria-label={allChannelsMonitored ? "Disable monitor on all channels" : "Enable monitor on all channels"}
          onClick={onToggleAllMonitor}
        >
          <MonitorPassThroughIcon />
        </button>
        <button
          className={`${styles.recordArmToggle} ${allChannelsArmed ? styles.recordArmToggleActive : ""}`}
          type="button"
          title={allChannelsArmed ? "Disarm all channels for recording." : "Arm all channels for recording."}
          aria-label={allChannelsArmed ? "Disarm all channels" : "Arm all channels"}
          onClick={onToggleAllRecordArm}
        >
          ●
        </button>
        <button
          className={`${styles.eyeToggle} ${allChannelsVisible ? styles.eyeToggleActive : ""}`}
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
          👁
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
              onChange={(event) => setChannelColor((prev) => ({ ...prev, [channel]: event.target.value }))}
              title="Set channel color"
            />
            <span className={styles.channelLabel} title={channel}>
              {channel}
            </span>
            <button
              className={`${styles.monitorToggle} ${monitorByChannel[channel] ? styles.monitorToggleActive : ""}`}
              type="button"
              title={monitorByChannel[channel] ? "Disable live input monitor for this channel." : "Enable live input monitor for this channel."}
              aria-label={monitorByChannel[channel] ? "Disable live input monitor for this channel" : "Enable live input monitor for this channel"}
              onClick={(event) => {
                event.stopPropagation();
                onToggleChannelMonitor(channel);
              }}
            >
              <MonitorPassThroughIcon />
            </button>
            <button
              className={`${styles.recordArmToggle} ${recordArmByChannel[channel] ? styles.recordArmToggleActive : ""}`}
              type="button"
              title={recordArmByChannel[channel] ? "Disarm recording for this channel." : "Arm recording for this channel."}
              aria-label={recordArmByChannel[channel] ? "Disarm recording for this channel" : "Arm recording for this channel"}
              onClick={(event) => {
                event.stopPropagation();
                onToggleChannelRecordArm(channel);
              }}
            >
              ●
            </button>
            <button
              className={`${styles.eyeToggle} ${channelVisible[channel] !== false ? styles.eyeToggleActive : ""}`}
              type="button"
              title={channelVisible[channel] !== false ? "Hide channel" : "Show channel"}
              aria-label={channelVisible[channel] !== false ? "Hide channel" : "Show channel"}
              onClick={(event) =>
                setChannelVisible((prev) => {
                  if (event.shiftKey) {
                    const currentlyVisible = channelNames.filter((name) => prev[name] !== false);
                    const isSolo = currentlyVisible.length === 1 && currentlyVisible[0] === channel;
                    if (isSolo) {
                      const showAll: Record<string, boolean> = { ...prev };
                      for (const name of channelNames) {
                        showAll[name] = true;
                      }
                      return showAll;
                    }
                    const solo: Record<string, boolean> = { ...prev };
                    for (const name of channelNames) {
                      solo[name] = name === channel;
                    }
                    return solo;
                  }
                  return {
                    ...prev,
                    [channel]: prev[channel] === false,
                  };
                })
              }
            >
              👁
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
