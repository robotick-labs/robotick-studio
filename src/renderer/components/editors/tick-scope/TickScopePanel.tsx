import { defineStudioPanel } from "../../workbenches/PanelInstanceContext";
import TickScopePage from "./TickScopePage";
import { tickScopePagePersistence } from "./TickScopePage.persistence";

export const contribution = defineStudioPanel({
  component: TickScopePage,
  persistence: tickScopePagePersistence,
});

export default TickScopePage;
