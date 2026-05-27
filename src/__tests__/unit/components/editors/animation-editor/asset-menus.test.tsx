import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActiveClipFieldMenu } from "../../../../../renderer/components/editors/animation-editor/ActiveClipFieldMenu";
import { AnimSetFieldMenu } from "../../../../../renderer/components/editors/animation-editor/AnimSetFieldMenu";

describe("animation asset menus", () => {
  it("invokes animset authoring actions", () => {
    const onCreate = vi.fn();
    const onDuplicate = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();

    render(
      <AnimSetFieldMenu
        animsetOptions={["content/anim/animsets/base.animset.yaml"]}
        animsetPath={"content/anim/animsets/base.animset.yaml"}
        onSelectAnimsetPath={vi.fn()}
        onCreate={onCreate}
        onDuplicate={onDuplicate}
        onRename={onRename}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "AnimSet actions" }));
    const actionMenu = screen.getByRole("menu", { name: "AnimSet actions" });
    fireEvent.click(within(actionMenu).getByRole("button", { name: "New" }));
    fireEvent.click(within(actionMenu).getByRole("button", { name: "Duplicate" }));
    fireEvent.click(within(actionMenu).getByRole("button", { name: "Rename" }));
    fireEvent.click(within(actionMenu).getByRole("button", { name: "Delete" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("invokes active clip authoring actions", () => {
    const onCreate = vi.fn();
    const onDuplicate = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();

    render(
      <ActiveClipFieldMenu
        clipRefs={[{ name: "idle", animclipPath: "content/anim/animclips/idle.animclip.yaml" }]}
        selectedClipPath={"content/anim/animclips/idle.animclip.yaml"}
        onReload={vi.fn()}
        onSelectClipPath={vi.fn()}
        onCreate={onCreate}
        onDuplicate={onDuplicate}
        onRename={onRename}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Active clip actions" }));
    const actionMenu = screen.getByRole("menu", { name: "Active clip actions" });
    fireEvent.click(within(actionMenu).getByRole("button", { name: "New" }));
    fireEvent.click(within(actionMenu).getByRole("button", { name: "Duplicate" }));
    fireEvent.click(within(actionMenu).getByRole("button", { name: "Rename" }));
    fireEvent.click(within(actionMenu).getByRole("button", { name: "Delete" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
