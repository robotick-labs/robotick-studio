## Panel Layout – Split & Assign UX

### Goals
- Allow any workspace body to be subdivided into multiple panels that can each host any tool.
- Keep the split mechanic simple and repeatable so users quickly build muscle memory.
- Ensure every arrangement is persistable per-workspace so the IDE opens exactly as it was left.

### Panel behaviors
1. **Corner handle**
   - Each panel surface shows a small grabber in its top-right corner.
   - Dragging the handle toward the interior of the panel previews a proposed split direction (horizontal if dragged sideways, vertical if dragged downward).
   - Releasing performs the split, creating two sibling panels that initially mirror the previous content.
2. **Context menu**
   - Right-clicking inside a panel opens a menu scoped to the click location.
   - Menu entries: `Split Horizontally`, `Split Vertically`, `Assign Tool…`, `Close Panel`, `Maximize Panel`.
   - Choosing a split option inserts the new divide that passes through the click position, so users can decide which sub-area becomes larger/smaller.
3. **Assigning content**
   - Every panel header includes a compact dropdown showing the current tool (e.g., `Remote Control`, `Telemetry`, `Terminal`, `Models`).
   - Selecting a new entry swaps just that panel’s content.
   - The context menu’s `Assign Tool…` item opens the same selector for users who prefer right-click workflows.
4. **Joining panels**
   - Dragging the corner handle across an adjacent panel, or choosing `Close Panel`, removes the current split and lets the neighboring panel reclaim the full space.
   - When only one panel remains, its handle/menus still exist so users can start splitting again.

### Keyboard/mouse shortcuts
- `Double-click` the corner handle: quick toggle between maximized and normal size for that panel.
- `Shift + Drag` on the handle: constrain to the opposite split direction (e.g., force vertical even when dragging slightly horizontal), assisting precise control.
- Menu items display their shortcuts (e.g., `Split Horizontally (Shift+Alt+H)`) to reinforce learnability.

### Persistence
- Each workspace tracks its panel tree (split orientation, relative sizes, assigned tools).
- Persist the serialized layout in `localStorage` using a key such as `panelLayout:<workspaceId>` so every workspace restores exactly how it was left across reloads.
- When switching workspaces, restore the saved layout; initial defaults can define common setups (single panel for new workspaces, or curated layouts for “Remote Control,” “Telemetry,” etc.).

### Future considerations
- Support dragging tabs/tools between panels as a secondary affordance.
- Expose a “Layouts” dropdown in the toolbar so users can reset or save named layouts if desired.
