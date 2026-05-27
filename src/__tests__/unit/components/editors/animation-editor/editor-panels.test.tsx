import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { AnimationChannelsPanel } from "../../../../../renderer/components/editors/animation-editor/AnimationChannelsPanel";
import { AnimationTargetPanel } from "../../../../../renderer/components/editors/animation-editor/AnimationTargetPanel";

describe("AnimationTargetPanel", () => {
  it("wires source selection and save actions", () => {
    const setSelectedSourceId = vi.fn();
    const onSave = vi.fn();

    render(
      <AnimationTargetPanel
        animLoadStatus={{ level: "ok", message: "OK" }}
        animsetOptions={["content/anim/animsets/base.animset.yaml"]}
        animsetPath={"content/anim/animsets/base.animset.yaml"}
        applyAnimsetPath={vi.fn()}
        channelsetId={"face_v1"}
        channelsetPath={"content/anim/channelsets/face.channelset.yaml"}
        clipRefs={[{ name: "idle", animclipPath: "content/anim/animclips/idle.animclip.yaml" }]}
        compatibleSources={[
          { id: "a", label: "Model A | anim" },
          { id: "b", label: "Model B | anim" },
        ]}
        onCreateAnimset={vi.fn()}
        onCreateClip={vi.fn()}
        onDeleteAnimset={vi.fn()}
        onDeleteClip={vi.fn()}
        onDuplicateAnimset={vi.fn()}
        onDuplicateClip={vi.fn()}
        onReloadClipRefs={vi.fn()}
        onRenameAnimset={vi.fn()}
        onRenameClip={vi.fn()}
        onSave={onSave}
        saveButtonUi={{
          label: "Save",
          title: "Save dirty animation changes.",
          disabled: false,
          tone: "dirty",
          showDirtyDot: true,
        }}
        selectedClipPath={"content/anim/animclips/idle.animclip.yaml"}
        selectedSourceId={"a"}
        setSelectedSourceId={setSelectedSourceId}
        applyActiveClipPath={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Auto-save" })).toBeDisabled();
    expect(screen.getByText("face.channelset.yaml (read-only)")).toBeInTheDocument();
    expect(screen.getByTitle("Save dirty animation changes.").querySelector("span[aria-hidden='true']")).not.toBeNull();
    expect(setSelectedSourceId).toHaveBeenCalledWith("b");
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("AnimationChannelsPanel", () => {
  it("supports shift-solo visibility toggles and restore", () => {
    function Harness() {
      const [channelVisible, setChannelVisible] = React.useState<Record<string, boolean>>({
        look_x: true,
        look_y: true,
      });
      const [channelColor, setChannelColor] = React.useState<Record<string, string>>({
        look_x: "#77ceff",
        look_y: "#7ef9a9",
      });
      const [hoveredChannel, setHoveredChannel] = React.useState<string | null>(null);
      const [recordArmByChannel, setRecordArmByChannel] = React.useState<Record<string, boolean>>({});
      const [selectedChannel, setSelectedChannel] = React.useState<string | null>(null);
      return (
        <>
          <AnimationChannelsPanel
            allChannelsArmed={false}
            allChannelsVisible={channelVisible.look_x !== false && channelVisible.look_y !== false}
            channelColor={channelColor}
            channelNames={["look_x", "look_y"]}
            channelVisible={channelVisible}
            hoveredChannel={hoveredChannel}
            recordArmByChannel={recordArmByChannel}
            selectedChannel={selectedChannel}
            setChannelColor={setChannelColor}
            setChannelVisible={setChannelVisible}
            setHoveredChannel={setHoveredChannel}
            setRecordArmByChannel={setRecordArmByChannel}
            setSelectedChannel={setSelectedChannel}
          />
          <div data-testid="visibility-state">{JSON.stringify(channelVisible)}</div>
        </>
      );
    }

    render(<Harness />);

    const buttons = screen.getAllByRole("button", { name: "Hide channel" });
    fireEvent.click(buttons[0], { shiftKey: true });
    expect(screen.getByTestId("visibility-state")).toHaveTextContent('{"look_x":true,"look_y":false}');

    fireEvent.click(screen.getByRole("button", { name: "Hide channel" }), { shiftKey: true });
    expect(screen.getByTestId("visibility-state")).toHaveTextContent('{"look_x":true,"look_y":true}');
  });
});
