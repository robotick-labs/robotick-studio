import React from "react";

import type { useTelemetryService, ITelemetryField } from "../../../../data-sources/telemetry";

type UseAnimControlFieldsArgs = {
  telemetryBaseUrl: string;
  telemetryModel: {
    schemaSessionId?: string;
    workloads: Array<{ name: string }>;
    getField?: (fieldPath: string) => ITelemetryField | undefined;
  } | null;
  telemetryService: ReturnType<typeof useTelemetryService>;
  selectedSourceWorkloadName: string;
  selectedWorkloadName: string;
};

export function useAnimControlFields({
  telemetryBaseUrl,
  telemetryModel,
  telemetryService,
  selectedSourceWorkloadName,
  selectedWorkloadName,
}: UseAnimControlFieldsArgs) {
  const heldSuppressedAnimControlFieldsRef = React.useRef<Set<string>>(new Set());

  const readFieldValue = React.useCallback(
    (fieldPath: string) => telemetryModel?.getField?.(fieldPath)?.getValue?.(),
    [telemetryModel]
  );

  const resolveAnimWritableField = React.useCallback(
    (suffix: string): { fieldPath: string; field: ITelemetryField } | null => {
      if (!telemetryModel) return null;
      const candidateWorkloadNames = [selectedWorkloadName, selectedSourceWorkloadName].filter(
        (name, idx, arr) => name.length > 0 && arr.indexOf(name) === idx
      );

      for (const workloadName of candidateWorkloadNames) {
        const fieldPath = `${workloadName}.${suffix}`;
        const field = telemetryModel.getField?.(fieldPath);
        if (field && typeof field.writable_input_handle === "number") {
          return { fieldPath, field };
        }
      }

      for (const workload of telemetryModel.workloads) {
        const fieldPath = `${workload.name}.${suffix}`;
        const field = telemetryModel.getField?.(fieldPath);
        if (field && typeof field.writable_input_handle === "number") {
          return { fieldPath, field };
        }
      }
      return null;
    },
    [selectedSourceWorkloadName, selectedWorkloadName, telemetryModel]
  );

  const resolveWritableField = React.useCallback(
    (fieldPath: string): ITelemetryField | null => {
      const field = telemetryModel?.getField?.(fieldPath);
      if (!field) return null;
      if (typeof field.writable_input_handle !== "number") return null;
      return field;
    },
    [telemetryModel]
  );

  const setAnimControlConnectionState = React.useCallback(
    async (fieldName: string, enabled: boolean) => {
      if (!telemetryBaseUrl || !telemetryModel?.schemaSessionId) return false;
      const resolved = resolveAnimWritableField(`inputs.anim_controls.${fieldName}`);
      if (!resolved) return false;
      const result = await telemetryService.setWorkloadInputConnectionState(telemetryBaseUrl, {
        engine_session_id: telemetryModel.schemaSessionId,
        updates: [{ field_handle: resolved.field.writable_input_handle, field_path: resolved.fieldPath, enabled }],
      });
      if (!result.ok) {
        console.warn("Anim control connection state update rejected", {
          fieldPath: resolved.fieldPath,
          enabled,
          status: result.status,
          body: result.body,
        });
      }
      return result.ok;
    },
    [resolveAnimWritableField, telemetryBaseUrl, telemetryModel, telemetryService]
  );

  const writeAnimControlFieldRaw = React.useCallback(
    async (fieldName: string, value: unknown) => {
      if (!telemetryBaseUrl || !telemetryModel?.schemaSessionId) return false;
      const resolved = resolveAnimWritableField(`inputs.anim_controls.${fieldName}`);
      if (!resolved) return false;
      const result = await telemetryService.setWorkloadInputFieldsData(telemetryBaseUrl, {
        engine_session_id: telemetryModel.schemaSessionId,
        writes: [{ field_handle: resolved.field.writable_input_handle, field_path: resolved.fieldPath, value }],
      });
      if (!result.ok) {
        console.warn("Anim control write rejected", {
          fieldPath: resolved.fieldPath,
          value,
          status: result.status,
          body: result.body,
        });
      }
      return result.ok;
    },
    [resolveAnimWritableField, telemetryBaseUrl, telemetryModel, telemetryService]
  );

  const writeAnimControlField = React.useCallback(
    async (fieldName: string, value: unknown) => {
      if (!telemetryBaseUrl || !telemetryModel?.schemaSessionId || !selectedWorkloadName) return;
      const fieldPath = `${selectedWorkloadName}.inputs.anim_controls.${fieldName}`;
      const field = resolveWritableField(fieldPath);
      if (!field) return;

      const incomingConnectionHandle = field.incoming_connection_handle;
      const incomingConnectionEnabled = field.incoming_connection_enabled !== false;
      if (typeof incomingConnectionHandle === "number" && incomingConnectionEnabled) {
        await telemetryService.setWorkloadInputConnectionState(telemetryBaseUrl, {
          engine_session_id: telemetryModel.schemaSessionId,
          updates: [{ field_handle: field.writable_input_handle, field_path: fieldPath, enabled: false }],
        });
      }

      await telemetryService.setWorkloadInputFieldsData(telemetryBaseUrl, {
        engine_session_id: telemetryModel.schemaSessionId,
        writes: [{ field_handle: field.writable_input_handle, field_path: fieldPath, value }],
      });

      if (typeof incomingConnectionHandle === "number" && incomingConnectionEnabled) {
        await telemetryService.setWorkloadInputConnectionState(telemetryBaseUrl, {
          engine_session_id: telemetryModel.schemaSessionId,
          updates: [{ field_handle: field.writable_input_handle, field_path: fieldPath, enabled: true }],
        });
      }
    },
    [resolveWritableField, selectedWorkloadName, telemetryBaseUrl, telemetryModel, telemetryService]
  );

  const ensureAnimControlSuppressed = React.useCallback(
    async (fieldName: string): Promise<boolean> => {
      if (!telemetryBaseUrl || !telemetryModel?.schemaSessionId) return false;
      if (heldSuppressedAnimControlFieldsRef.current.has(fieldName)) return true;
      const resolved = resolveAnimWritableField(`inputs.anim_controls.${fieldName}`);
      if (!resolved) return false;
      if (typeof resolved.field.incoming_connection_handle !== "number") return false;
      const result = await telemetryService.setWorkloadInputConnectionState(telemetryBaseUrl, {
        engine_session_id: telemetryModel.schemaSessionId,
        updates: [{ field_handle: resolved.field.writable_input_handle, field_path: resolved.fieldPath, enabled: false }],
      });
      if (!result.ok) return false;
      heldSuppressedAnimControlFieldsRef.current.add(fieldName);
      return true;
    },
    [resolveAnimWritableField, telemetryBaseUrl, telemetryModel, telemetryService]
  );

  return {
    heldSuppressedAnimControlFieldsRef,
    readFieldValue,
    resolveAnimWritableField,
    setAnimControlConnectionState,
    writeAnimControlField,
    writeAnimControlFieldRaw,
    ensureAnimControlSuppressed,
  };
}
