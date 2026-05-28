import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAnimControlFields } from "../../../../../renderer/components/editors/animation-editor/hooks/useAnimControlFields";

describe("useAnimControlFields", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the source workload when resolving writable anim control fields", () => {
    const field = {
      writable_input_handle: 17,
      incoming_connection_handle: 99,
      incoming_connection_enabled: true,
    };

    const telemetryModel = {
      schemaSessionId: "schema-1",
      workloads: [{ name: "actual_anim_workload" }, { name: "unrelated" }],
      getField: vi.fn((fieldPath: string) => {
        if (fieldPath === "actual_anim_workload.inputs.anim_controls.loop") {
          return field;
        }
        return undefined;
      }),
    };

    const { result } = renderHook(() =>
      useAnimControlFields({
        telemetryBaseUrl: "http://telemetry",
        telemetryModel: telemetryModel as never,
        telemetryService: {
          setWorkloadInputConnectionState: vi.fn(),
          setWorkloadInputFieldsData: vi.fn(),
        } as never,
        selectedSourceWorkloadName: "actual_anim_workload",
        selectedWorkloadName: "stale_model_workload",
      })
    );

    expect(result.current.resolveAnimWritableField("inputs.anim_controls.loop")).toEqual({
      fieldPath: "actual_anim_workload.inputs.anim_controls.loop",
      field,
    });
  });

  it("suppresses and restores incoming connections around writes on the selected workload", async () => {
    const setWorkloadInputConnectionState = vi.fn().mockResolvedValue({ ok: true });
    const setWorkloadInputFieldsData = vi.fn().mockResolvedValue({ ok: true });

    const field = {
      writable_input_handle: 17,
      incoming_connection_handle: 99,
      incoming_connection_enabled: true,
    };

    const telemetryModel = {
      schemaSessionId: "schema-1",
      workloads: [{ name: "actual_anim_workload" }, { name: "unrelated" }],
      getField: vi.fn((fieldPath: string) => {
        if (fieldPath === "actual_anim_workload.inputs.anim_controls.loop") {
          return field;
        }
        return undefined;
      }),
    };

    const { result } = renderHook(() =>
      useAnimControlFields({
        telemetryBaseUrl: "http://telemetry",
        telemetryModel: telemetryModel as never,
        telemetryService: {
          setWorkloadInputConnectionState,
          setWorkloadInputFieldsData,
        } as never,
        selectedSourceWorkloadName: "actual_anim_workload",
        selectedWorkloadName: "actual_anim_workload",
      })
    );

    await act(async () => {
      await result.current.writeAnimControlField("loop", true);
    });

    expect(setWorkloadInputConnectionState).toHaveBeenNthCalledWith(1, "http://telemetry", {
      engine_session_id: "schema-1",
      updates: [
        {
          field_handle: 17,
          field_path: "actual_anim_workload.inputs.anim_controls.loop",
          enabled: false,
        },
      ],
    });
    expect(setWorkloadInputFieldsData).toHaveBeenCalledWith("http://telemetry", {
      engine_session_id: "schema-1",
      writes: [
        {
          field_handle: 17,
          field_path: "actual_anim_workload.inputs.anim_controls.loop",
          value: true,
        },
      ],
    });
    expect(setWorkloadInputConnectionState).toHaveBeenNthCalledWith(2, "http://telemetry", {
      engine_session_id: "schema-1",
      updates: [
        {
          field_handle: 17,
          field_path: "actual_anim_workload.inputs.anim_controls.loop",
          enabled: true,
        },
      ],
    });
  });

  it("suppresses an anim control only once when the field is already held", async () => {
    const setWorkloadInputConnectionState = vi.fn().mockResolvedValue({ ok: true });
    const field = {
      writable_input_handle: 23,
      incoming_connection_handle: 55,
      incoming_connection_enabled: true,
    };
    const telemetryModel = {
      schemaSessionId: "schema-2",
      workloads: [{ name: "actual_anim_workload" }],
      getField: vi.fn((fieldPath: string) => {
        if (fieldPath === "actual_anim_workload.inputs.anim_controls.time_override_sec") {
          return field;
        }
        return undefined;
      }),
    };

    const { result } = renderHook(() =>
      useAnimControlFields({
        telemetryBaseUrl: "http://telemetry",
        telemetryModel: telemetryModel as never,
        telemetryService: {
          setWorkloadInputConnectionState,
          setWorkloadInputFieldsData: vi.fn(),
        } as never,
        selectedSourceWorkloadName: "actual_anim_workload",
        selectedWorkloadName: "actual_anim_workload",
      })
    );

    await act(async () => {
      expect(await result.current.ensureAnimControlSuppressed("time_override_sec")).toBe(true);
      expect(await result.current.ensureAnimControlSuppressed("time_override_sec")).toBe(true);
    });

    expect(setWorkloadInputConnectionState).toHaveBeenCalledTimes(1);
  });
});
