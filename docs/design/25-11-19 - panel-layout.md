## Panel Layout – Split & Assign UX

### Goals
- Allow any workbench body to be subdivided into multiple panels that can each host any tool.
- Keep the split mechanic simple and repeatable so users quickly build muscle memory.
- Ensure every arrangement is persistable per-workbench so the IDE opens exactly as it was left.
- Provide a lightweight way to detach panels so users can float tools across displays or keep them visible while navigating other areas.

### Panel behaviors
1. **Corner handle**
   - Each panel surface shows a small grabber in its top-right corner.
   - Dragging the handle toward the interior of the panel previews a proposed split direction (horizontal if dragged sideways, vertical if dragged downward).
   - Releasing performs the split, creating two sibling panels that initially mirror the previous content.
2. **Context menu**
   - Right-clicking inside a panel opens a menu scoped to the click location.
   - RMB gesture is tap-vs-hold gated:
     - tap (`<=100ms`) opens the panel context menu
     - hold (`>100ms`) does not open the panel context menu (reserved for editor-level gestures like viewport pan)
   - Menu entries: `Split Horizontally`, `Split Vertically`, `Assign Tool…`, `Close Panel`, `Maximize Panel`, `Reset Layout`.
   - Choosing a split option inserts the new divide that passes through the click position, so users can decide which sub-area becomes larger/smaller.
3. **Assigning content**
   - Every panel header includes a compact dropdown showing the current tool (e.g., `Remote Control`, `Telemetry`, `Terminal`, `Models`).
   - Selecting a new entry swaps just that panel’s content.
   - The context menu’s `Assign Tool…` item opens the same selector for users who prefer right-click workflows.
4. **Joining panels**
   - Dragging the corner handle across an adjacent panel, or choosing `Close Panel`, removes the current split and lets the neighboring panel reclaim the full space.
   - When only one panel remains, its handle/menus still exist so users can start splitting again.

### Floating panels
- The panel context menu exposes `Create Floating Panel`, which calls `spawnFloatingPanel` with the current editor so you can duplicate any tool into its own mode, optionally passing `initialPosition`, `initialSize`, or `minSize` hints.
- Floating windows render through `FloatingPanelLayer`, which portals a `GenericPanel` per record and listens to `floating-panel-store`; dragging, resizing, and closing use `GenericPanel` so each floating panel saves its bounds under `generic-panel:floating-panel:<workbenchId>:<panelId>`, while the overall list persists via `floating-panels:<workbenchId>`.
- Each floating window still surfaces an `Assign Tool…` dropdown (rendered outside the workbench grid) and reuses `PanelContextMenu` for duplicating the window (`Split…` buttons act as “duplicate”) plus the same close action, but it hides the float/maximize/reset entries since those don’t apply.
- Editors rendered inside a floating panel can call `useFloatingPanel()` to update `title`, `settings`, or call `close()`, keeping metadata tied to that panel instead of the grid.
- Closing a floating panel simply removes it from the `floating-panel-store`; docking back into the grid is not implemented yet, so the regular layout stays unchanged when a floating window lives or dies.

### Keyboard/mouse shortcuts
- `Double-click` the corner handle: quick toggle between maximized and normal size for that panel.
- `Shift + Drag` on the handle: constrain to the opposite split direction (e.g., force vertical even when dragging slightly horizontal), assisting precise control.
- Menu items display their shortcuts (e.g., `Split Horizontally (Shift+Alt+H)`) to reinforce learnability.

### Persistence
- Each workbench tracks its panel tree (split orientation, relative sizes, assigned tools).
- Historical note:
  the original draft described pure `localStorage` persistence. The current implementation seeds and persists canonical layouts inside `robots/<project>/studio/studio.yaml`, with renderer-local keys used only as legacy migration sources.
- When switching workbenches, restore the saved layout; initial defaults can define common setups (single panel for new workspaces, or curated layouts for “Remote Control,” “Telemetry,” etc.).

### Editor registry
- A new `src/renderer/config/app-editors.yaml` lists every available editor along with the module path that renders it.
- Seeded workbench entries in `studio.template.yaml` reference these editor IDs (rather than raw module paths) so layouts can mix-and-match any registered editor.
- The panel selector shows this editor list, and assigning a panel simply swaps which editor ID it points to.

### Future considerations
- Support dragging tabs/tools between panels as a secondary affordance.
- Expose a “Layouts” dropdown in the toolbar so users can reset or save named layouts if desired.
