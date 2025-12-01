# Robotick Unified Studio + VS Code Architecture

## Overview

Robotick is converging on a clean, modern architecture:  
**one Launcher backend**, **two frontends (Studio + VS Code)**, and a **project-file that pins engine and workload versions**.  
This gives Robotick a reproducible, deterministic, developer‑friendly workflow across embedded and desktop platforms.

---

## Core Concepts

### 1. Launcher (Python)

The Launcher is the shared backend for everything:

- Reads `robotick.project.yaml` and model.yaml / other config files
- Fetches and pins engine + workloads into `.launcher/deps`
- Builds engine/workloads as needed (into `.launcher/deps`)
- Starts and manages engine processes
- Streams telemetry
- Exposes debug metadata (PID, ports)
- JSON‑RPC/WebSocket API used by both Studio and VS Code

Launcher becomes the “Robotick language server” for coding, running, debugging, and visualisation.

---

### 2. Project File (<robot-name>.project.yaml)

Defines the complete robot environment:

- Engine repo + pinned commit/tag
- Workload repo(s) + pinned commits/tags
- Optional global plugins (though many will still be specified by individual workloads)
- Target platform (esp32, ubuntu, pi)
- Studio/Launcher build preferences

This makes Robotick projects **self-contained and reproducible**, like a modern game-engine or package-managed workspace.

---

### 3. Studio (TS/React)

Robotick’s visual cockpit:

- Splitter-based multi-panel layout (Blender-like)
- Telemetry visualisation
- RC controls
- Face/emotion views
- Model graph views
- Simulator integration (e.g., MuJoCoWorkload)
- Automatically starts Launcher when a project opens

Studio is the “robot operator / creative workspace.”

---

### 4. VS Code Extension

Robotick’s developer shell:

- Connects to Launcher for project state
- Access to pinned engine/workload paths
- One-click “Run Engine”
- One-click “Attach Debugger” (no launch.json)
- Code intelligence and diagnostics
- Can embed Studio panels as VS Code webviews

VS Code = coding, debugging, editing.  
Studio = visualisation, control, dashboards.  
Both use the same Launcher as their brain.

---

## Vision

Robotick becomes:

- a unified engine-like robotics environment
- a reproducible project-based workflow
- a dual-interface system (Studio + VS Code)
- powered by a single Launcher backend
- suitable for embedded, desktop, expressive, and research-grade robots

A cohesive ecosystem with clean boundaries and modern developer ergonomics.
