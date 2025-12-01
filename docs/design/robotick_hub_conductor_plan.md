
# 🪆 Robotick Hub / Conductor Architecture Plan

This plan describes how the `robotick-hub` web IDE surfaces through the conductor layers and the Robotick Studio shell that hosts it.

## 🎯 Goal
Support multi-layered bots (Dev-PC → Pi5 → ESP32) with one consistent web entrypoint and rich Hub UI.

This follows a "Russian Doll" metaphor — each layer contains and proxies to the one below it, with only the outermost layer needing to serve the UI and manage the browser.

---

## 1. 🧠 Central Orchestrator = `robotick-conductor`
- Launches all layers (local, Pi, ESP32)
- Assigns unique REST ports to each
- Knows full routing structure
- Serves **stub page** on `localhost:8080`

---

## 2. 🌍 The Stub Page
- Served by `robotick-conductor` (or Pi5 in standalone mode)
- Loads Hub UI from `https://hub.robotick.org/entry.js`
- Passes `host = location.origin` to Hub init

---

## 3. 🔁 The Proxy Layer (inside conductor)
- Proxies browser requests like:
  - `/telemetry/spine/gyro` → `http://localhost:5002/telemetry/gyro`
  - `/telemetry/brain/temp` → `http://localhost:5001/telemetry/temp`
- Ensures **all browser fetches are same-origin** (no CORS/mixed-content issues)

---

## 4. 🤖 Layer Responsibilities

| Layer   | Serves UI | Exposes REST | Proxies Others |
|---------|------------|---------------|----------------|
| Dev-PC  | ✅ via Conductor | ✅ (sim or local) | ✅ full router |
| Pi5     | ✅ if standalone | ✅ brain APIs | ✅ to ESP32 |
| ESP32   | ❌           | ✅ telemetry/control | ❌ |

---

## 5. 🧪 Simulation Support
- All layers can run locally
- Conductor handles all ports + proxy logic
- Clean dev experience, same as live robot

---

## ✅ Result
One Hub UI → access to full robot system  
No CORS, no mixed-content, no conflicts  
Scalable from classroom demo to pro deployment
