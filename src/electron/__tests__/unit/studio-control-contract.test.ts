import { describe, expect, it } from "vitest";
import type {
  StudioControlCommandDescriptor,
  StudioControlDiagnosticsConsoleRecord,
  StudioControlDiagnosticsCssQuery,
  StudioControlDiagnosticsDomQuery,
  StudioControlDiagnosticsDomSummary,
  StudioControlDiagnosticsFetchCheckResult,
  StudioControlDiagnosticsScreenshot,
  StudioControlDiagnosticsSnapshot,
  StudioControlDiagnosticsStatus,
  StudioControlDiagnosticsTelemetryModelHealth,
  StudioControlRedactionNotice,
  StudioControlTruncationMetadata,
} from "../../common/studio-control-contract";

describe("studio control contracts", () => {
  it("round-trips command descriptors and redaction metadata through JSON serialization", () => {
    const descriptor: StudioControlCommandDescriptor = {
      id: "studio.diagnostics.dom.query",
      title: "Query DOM",
      description: "Return bounded DOM query results.",
      provider: "renderer_assisted",
      input_schema: {
        type: "object",
        required: ["selector"],
        properties: {
          selector: { type: "string" },
        },
      },
      output_schema: {
        type: "object",
        properties: {
          resource_type: { const: "studio_diagnostics_dom_query" },
        },
      },
      availability: {
        requires_live_instance: true,
        requires_renderer: true,
        resource_scope: "diagnostics",
      },
      read_only: true,
      destructive: false,
    };
    const redaction: StudioControlRedactionNotice = {
      path: "matches[0].selected_value",
      reason: "input_value",
      replacement: "[redacted]",
    };
    const roundTripped = JSON.parse(
      JSON.stringify({ descriptor, redaction })
    ) as {
      descriptor: StudioControlCommandDescriptor;
      redaction: StudioControlRedactionNotice;
    };

    expect(roundTripped.descriptor.id).toBe("studio.diagnostics.dom.query");
    expect(roundTripped.descriptor.provider).toBe("renderer_assisted");
    expect(roundTripped.redaction.reason).toBe("input_value");
  });

  it("serializes truncation-aware DOM and CSS diagnostics contracts", () => {
    const truncation: StudioControlTruncationMetadata = {
      truncated: true,
      original_count: 25,
      returned_count: 10,
      limit: 10,
    };
    const domSummary: StudioControlDiagnosticsDomSummary = {
      resource_type: "studio_diagnostics_dom_summary",
      instance_id: "studio-1234",
      window_id: "main",
      url: "http://localhost:5173/remote-control",
      document_title: "Robotick Studio",
      active_route: "/remote-control",
      visible_workbench_root: "remote-control",
      focused_element_summary: "button[aria-label='Launch']",
      selected_project_text: "Pip.e",
      redactions: [],
      truncation,
    };
    const domQuery: StudioControlDiagnosticsDomQuery = {
      resource_type: "studio_diagnostics_dom_query",
      instance_id: "studio-1234",
      window_id: "main",
      selector: "[data-project-picker]",
      match_count: 1,
      matches: [
        {
          text: "Pip.e",
          attributes: { "data-project-picker": "true" },
          rect: { x: 12, y: 34, width: 180, height: 28 },
          visible: true,
          disabled: false,
          aria_label: "Project",
          aria_name: "Project",
          selected_value: null,
        },
      ],
      redactions: [],
      truncation,
    };
    const cssQuery: StudioControlDiagnosticsCssQuery = {
      resource_type: "studio_diagnostics_css_query",
      instance_id: "studio-1234",
      window_id: "main",
      selector: ".launcher-status",
      match_count: 1,
      matches: [
        {
          computed_styles: { display: "grid", visibility: "visible" },
          layout: {
            x: 10,
            y: 20,
            width: 300,
            height: 120,
            overflow_x: "hidden",
            overflow_y: "auto",
          },
        },
      ],
      loaded_stylesheet_urls: ["http://localhost:5173/assets/index.css"],
      failed_stylesheet_urls: [],
      truncation,
    };

    expect(JSON.parse(JSON.stringify(domSummary))).toMatchObject({
      resource_type: "studio_diagnostics_dom_summary",
      truncation: { truncated: true, limit: 10 },
    });
    expect(JSON.parse(JSON.stringify(domQuery))).toMatchObject({
      selector: "[data-project-picker]",
      matches: [{ aria_label: "Project" }],
    });
    expect(JSON.parse(JSON.stringify(cssQuery))).toMatchObject({
      loaded_stylesheet_urls: ["http://localhost:5173/assets/index.css"],
    });
  });

  it("serializes console, fetch-check, telemetry, screenshot, and snapshot contracts", () => {
    const consoleRecord: StudioControlDiagnosticsConsoleRecord = {
      window_id: "main",
      recorded_at: "2026-06-13T10:00:00.000Z",
      level: "error",
      message: "Failed to fetch",
      source_url: "http://localhost:5173/assets/index.js",
      line: 12,
      column: 7,
      stack: "Error: Failed to fetch",
      payload: { code: "network_error" },
    };
    const fetchCheck: StudioControlDiagnosticsFetchCheckResult = {
      target_id: "launcher-runtime",
      effective_url: "http://127.0.0.1:7001/v1/launcher/runtime",
      method: "GET",
      origin: "http://localhost:5173",
      ok: false,
      status_code: null,
      response_headers: {},
      error_name: "TypeError",
      error_message: "Failed to fetch",
      failure_classification: "refused_connection",
    };
    const telemetry: StudioControlDiagnosticsTelemetryModelHealth = {
      model_id: "pip-e-brain",
      telemetry_base_url: "ws://127.0.0.1:7010",
      hub_health_ok: true,
      renderer_health_ok: false,
      websocket_ok: false,
      last_sample_at: "2026-06-13T10:01:00.000Z",
      ingress_rate_hz: 24,
      presentation_rate_hz: 20,
      last_error: "websocket closed",
    };
    const screenshot: StudioControlDiagnosticsScreenshot = {
      resource_type: "studio_diagnostics_screenshot",
      instance_id: "studio-1234",
      window_id: "main",
      output_path: "/tmp/.robotick/diagnostics/main.png",
      mime_type: "image/png",
      generated_at: "2026-06-13T10:02:00.000Z",
      dimensions: { width: 320, height: 240 },
      active_window_url: "http://localhost:5173/remote-control",
      active_workbench_id: "remote-control",
      active_layout_id: "main:remote-control:default",
      active_panel_id: "panel-remote-control",
      capture_source: "electron_capture_page",
      validation: {
        nonblank_pixel_check: true,
        dominant_content_area: { x: 0, y: 0, width: 320, height: 240 },
        expected_resource_match: true,
      },
    };
    const status: StudioControlDiagnosticsStatus = {
      resource_type: "studio_diagnostics_status",
      instance_id: "studio-1234",
      instance_name: "studio-1234",
      pid: 1234,
      mode: "dev",
      started_at: "2026-06-13T10:00:00.000Z",
      selected_project_id: "pip-e",
      selected_project_path: "/tmp/pip-e.project.yaml",
      project_directory: "/tmp",
      project_file_name: "pip-e.project.yaml",
      project_display_name: "Pip.e",
      ui_project_label: "Pip.e",
      active_window_id: "main",
      focused_window_id: "main",
      active_workbench_id: "remote-control",
      active_layout_id: "main:remote-control:default",
      active_panel_id: null,
      diagnostics_capability_versions: {
        status: 1,
        endpoints: 1,
        renderer: 1,
        console: 1,
        screenshot: 1,
      },
      diagnostics_limits: {
        renderer_error_entries: 50,
        console_buffer_entries: 500,
        fetch_failure_entries: 50,
        websocket_failure_entries: 50,
      },
      limitations: [],
    };
    const snapshot: StudioControlDiagnosticsSnapshot = {
      resource_type: "studio_diagnostics_snapshot",
      instance_id: "studio-1234",
      generated_at: "2026-06-13T10:02:00.000Z",
      status,
      endpoints: null,
      renderer: null,
      console: {
        records: [consoleRecord],
        truncation: {
          truncated: false,
          original_count: 1,
          returned_count: 1,
          limit: 500,
        },
      },
      fetch_check: null,
      telemetry: null,
      dom_summary: null,
      screenshot,
      redactions: [
        {
          path: "console.records[0].payload.token",
          reason: "token",
          replacement: "[redacted]",
        },
      ],
    };

    const roundTripped = JSON.parse(
      JSON.stringify({ consoleRecord, fetchCheck, telemetry, screenshot, snapshot })
    ) as Record<string, unknown>;

    expect(roundTripped).toMatchObject({
      consoleRecord: { level: "error", payload: { code: "network_error" } },
      fetchCheck: { failure_classification: "refused_connection" },
      telemetry: { websocket_ok: false, model_id: "pip-e-brain" },
      screenshot: { mime_type: "image/png", dimensions: { width: 320, height: 240 } },
      snapshot: {
        resource_type: "studio_diagnostics_snapshot",
        redactions: [{ reason: "token" }],
      },
    });
  });
});
