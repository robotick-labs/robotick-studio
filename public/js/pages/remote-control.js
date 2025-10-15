// remote_control.js

import remoteControls from "../elements/remote-controls.js";
import viewer from "../elements/viewer/viewer.js";

export function init() {
  remoteControls.init();
  viewer.init();
}

export function uninit() {
  remoteControls.uninit();
  viewer.uninit();
}
