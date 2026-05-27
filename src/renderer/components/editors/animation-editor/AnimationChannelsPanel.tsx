import React from "react";

import styles from "./AnimationEditorPage.module.css";

type AnimationChannelsPanelProps = {
  allChannelsArmed: boolean;
  allChannelsVisible: boolean;
  channelColor: Record<string, string>;
  channelNames: string[];
  channelVisible: Record<string, boolean>;
  hoveredChannel: string | null;
  recordArmByChannel: Record<string, boolean>;
  selectedChannel: string | null;
  setChannelColor: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setChannelVisible: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setHoveredChannel: React.Dispatch<React.SetStateAction<string | null>>;
  setRecordArmByChannel: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSelectedChannel: React.Dispatch<React.SetStateAction<string | null>>;
};

export function AnimationChannelsPanel({
  allChannelsArmed,
  allChannelsVisible,
  channelColor,
  channelNames,
  channelVisible,
  hoveredChannel,
  recordArmByChannel,
  selectedChannel,
  setChannelColor,
  setChannelVisible,
  setHoveredChannel,
  setRecordArmByChannel,
  setSelectedChannel,
}: AnimationChannelsPanelProps) {
  return (
    <section className={styles.panelCard}>
      <div className={styles.channelsHeader}>
        <h3>Channels</h3>
        <button
          className={`${styles.recordArmToggle} ${allChannelsArmed ? styles.recordArmToggleActive : ""}`}
          type="button"
          title={allChannelsArmed ? "Disarm all channels (stub)." : "Arm all channels (stub)."}
          aria-label={allChannelsArmed ? "Disarm all channels" : "Arm all channels"}
          onClick={() =>
            setRecordArmByChannel((prev) => {
              const next: Record<string, boolean> = { ...prev };
              for (const name of channelNames) {
                next[name] = !allChannelsArmed;
              }
              return next;
            })
          }
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
              className={`${styles.recordArmToggle} ${recordArmByChannel[channel] ? styles.recordArmToggleActive : ""}`}
              type="button"
              title={recordArmByChannel[channel] ? "Disarm recording for this channel (stub)." : "Arm recording for this channel (stub)."}
              aria-label={recordArmByChannel[channel] ? "Disarm recording for this channel" : "Arm recording for this channel"}
              onClick={(event) => {
                event.stopPropagation();
                setRecordArmByChannel((prev) => ({ ...prev, [channel]: !prev[channel] }));
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
