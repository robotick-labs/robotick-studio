import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  launcherService,
  type WorkloadsRegistryEntry,
  type WorkloadsRegistryField,
  type WorkloadsRegistryStruct,
} from "../../../../../data-sources/launcher";
import { DocumentStore } from "../../document/documentStore";
import { useSelection } from "../../document/editorSelectionStore";
import styles from "../../styles/ModelsPage.module.css";

type PropertyPanelProps = {
  store: DocumentStore;
  selectionScope: string;
  projectPath: string;
};

type WorkloadSection = "config" | "inputs" | "outputs";

type SchemaState = {
  loading: boolean;
  error: string | null;
  byType: Map<string, WorkloadsRegistryEntry>;
};

type CachedSchema = {
  byType: Map<string, WorkloadsRegistryEntry>;
  loadedAtMs: number;
};

const SCHEMA_CACHE = new Map<string, CachedSchema>();

export const PropertyPanel: React.FC<PropertyPanelProps> = ({
  store,
  selectionScope,
  projectPath,
}) => {
  useSyncExternalStore(store.subscribe.bind(store), () => store.version);
  const selectedId = useSelection(selectionScope);
  const [schemaState, setSchemaState] = useState<SchemaState>({
    loading: false,
    error: null,
    byType: new Map(),
  });

  const loadSchema = useCallback(
    async (forceRefresh: boolean) => {
      const cacheKey = `${projectPath}::linux`;
      const cached = SCHEMA_CACHE.get(cacheKey);
      if (!forceRefresh && cached) {
        setSchemaState({
          loading: false,
          error: null,
          byType: cached.byType,
        });
        return;
      }

      setSchemaState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const response = await launcherService.fetchProjectWorkloadsRegistry(
          projectPath,
          "linux"
        );
        const byType = new Map<string, WorkloadsRegistryEntry>();
        for (const entry of response.registry ?? []) {
          if (entry.type?.trim()) {
            byType.set(entry.type, entry);
          }
        }
        SCHEMA_CACHE.set(cacheKey, { byType, loadedAtMs: Date.now() });
        setSchemaState({
          loading: false,
          error: null,
          byType,
        });
      } catch (error) {
        setSchemaState((prev) => ({
          ...prev,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load workload schema metadata",
        }));
      }
    },
    [projectPath]
  );

  useEffect(() => {
    void loadSchema(false);
  }, [loadSchema]);

  const selectedWorkload = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    const [base, wname] = selectedId.split(":", 2);
    if (!base || !wname) {
      return null;
    }
    for (const [modelId, model] of store.entries()) {
      const modelBase = modelId
        .split("/")
        .pop()
        ?.replace(/\.model\.yaml$/, "");
      if (modelBase !== base) continue;
      const workload = model.workloads.find((w) => w.name === wname) ?? null;
      if (workload) {
        return { modelId, workload };
      }
    }
    return null;
  }, [selectedId, store]);

  if (!selectedWorkload) {
    return (
      <div>
        <PanelHeader
          loading={schemaState.loading}
          onRefresh={() => void loadSchema(true)}
        />
        <p>Select a workload node to inspect schema-backed properties.</p>
        <ErrorViewer errors={schemaState.error ? [schemaState.error] : []} />
      </div>
    );
  }

  const { modelId, workload } = selectedWorkload;
  const workloadType = workload.type?.trim() ?? "";
  const schemaEntry = workloadType ? schemaState.byType.get(workloadType) : undefined;
  const schemaStructs = schemaEntry?.metadata?.structs ?? {};

  const validationErrors = buildValidationErrors(workload, schemaStructs);
  const fetchErrors = schemaState.error ? [schemaState.error] : [];
  const missingSchemaError =
    workloadType && !schemaEntry && !schemaState.loading
      ? [`No workload schema metadata found for type '${workloadType}'.`]
      : [];
  const allErrors = [...fetchErrors, ...missingSchemaError, ...validationErrors];

  return (
    <div>
      <PanelHeader
        loading={schemaState.loading}
        onRefresh={() => void loadSchema(true)}
      />
      <h3>
        <span>Properties</span>{" "}
        <span style={{ fontWeight: "normal" }}>| {workloadType || "Unknown"}</span>
      </h3>

      <PropertySection
        title="Core"
        fields={[
          { name: "name", type: "std::string", value: workload.name },
          { name: "tick_rate_hz", type: "number", value: workload.tick_rate_hz },
        ]}
      />

      <SchemaSection
        title="Config"
        section="config"
        schemaFields={getStructByName(schemaStructs, "config")?.fields ?? []}
        structs={schemaStructs}
        values={workload.config ?? {}}
        onRevert={(fieldPath) =>
          store.clearWorkloadFieldOverride(modelId, workload.name, "config", fieldPath)
        }
      />
      <SchemaSection
        title="Inputs"
        section="inputs"
        schemaFields={getStructByName(schemaStructs, "inputs")?.fields ?? []}
        structs={schemaStructs}
        values={workload.inputs ?? {}}
        onRevert={(fieldPath) =>
          store.clearWorkloadFieldOverride(modelId, workload.name, "inputs", fieldPath)
        }
      />
      <SchemaSection
        title="Outputs"
        section="outputs"
        schemaFields={getStructByName(schemaStructs, "outputs")?.fields ?? []}
        structs={schemaStructs}
        values={workload.outputs ?? {}}
        onRevert={(fieldPath) =>
          store.clearWorkloadFieldOverride(modelId, workload.name, "outputs", fieldPath)
        }
      />

      <ErrorViewer errors={allErrors} />
    </div>
  );
};

function PanelHeader({
  loading,
  onRefresh,
}: {
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className={styles.propPanelHeader}>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className={styles.propButton}
        aria-label="Refresh metadata"
      >
        {loading ? "Refreshing..." : "Refresh metadata"}
      </button>
    </div>
  );
}

function SchemaSection({
  title,
  schemaFields,
  structs,
  values,
  onRevert,
}: {
  title: string;
  schemaFields: WorkloadsRegistryField[];
  structs: Record<string, WorkloadsRegistryStruct>;
  values: Record<string, unknown>;
  onRevert: (fieldPath: string) => void;
}) {
  if (schemaFields.length === 0) {
    return (
      <div className={styles.propSection}>
        <h4>{title}</h4>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>No fields discovered</p>
      </div>
    );
  }

  return (
    <div className={styles.propSection}>
      <h4>{title}</h4>
      {schemaFields.map((field) => {
        const hasOverride = Object.prototype.hasOwnProperty.call(values, field.name);
        const rawValue = values[field.name];
        const display = getDisplayValue(rawValue, field.default);
        const nestedStruct = resolveStructType(structs, field.type);
        return (
          <div key={`${title}:${field.name}`} style={{ marginBottom: 8 }}>
            <FieldRow
              fieldPath={field.name}
              label={field.name}
              value={display}
              cppType={field.type}
              hasOverride={hasOverride}
              showRevert={true}
              onRevert={() => onRevert(field.name)}
            />
            {nestedStruct ? (
              <NestedStructFields
                path={field.name}
                struct={nestedStruct}
                structs={structs}
                value={rawValue}
                onRevert={onRevert}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function NestedStructFields({
  path,
  struct,
  structs,
  value,
  onRevert,
}: {
  path: string;
  struct: WorkloadsRegistryStruct;
  structs: Record<string, WorkloadsRegistryStruct>;
  value: unknown;
  onRevert: (fieldPath: string) => void;
}) {
  if (!isPlainObject(value) || !Array.isArray(struct.fields) || struct.fields.length === 0) {
    return null;
  }

  return (
    <div style={{ marginLeft: 12, marginTop: 6 }}>
      {struct.fields.map((field) => {
        const childPath = `${path}.${field.name}`;
        const hasOverride = Object.prototype.hasOwnProperty.call(value, field.name);
        const childValue = value[field.name];
        const display = getDisplayValue(childValue, field.default);
        const childStruct = resolveStructType(structs, field.type);
        return (
          <div key={childPath} style={{ marginBottom: 6 }}>
            <FieldRow
              fieldPath={childPath}
              label={childPath}
              value={display}
              cppType={field.type}
              hasOverride={hasOverride}
              showRevert={true}
              onRevert={() => onRevert(childPath)}
            />
            {childStruct ? (
              <NestedStructFields
                path={childPath}
                struct={childStruct}
                structs={structs}
                value={childValue}
                onRevert={onRevert}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function FieldRow({
  fieldPath,
  label,
  value,
  cppType,
  hasOverride,
  showRevert,
  onRevert,
}: {
  fieldPath: string;
  label: string;
  value: string;
  cppType: string;
  hasOverride: boolean;
  showRevert: boolean;
  onRevert: () => void;
}) {
  return (
    <div className={styles.propRow}>
      <div className={styles.propLabel} title={fieldPath}>
        {label}
      </div>
      <input
        className={hasOverride ? styles.propValueOverride : undefined}
        type="text"
        value={value}
        readOnly
        title={cppType}
        data-prop={fieldPath}
      />
      {showRevert ? (
        <button
          type="button"
          className={styles.propRevert}
          onClick={onRevert}
          disabled={!hasOverride}
          aria-label={`Revert ${fieldPath}`}
          title={`Revert ${fieldPath}`}
        >
          ↺
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function PropertySection({
  title,
  fields,
}: {
  title: string;
  fields: Array<{ name: string; type: string; value: unknown }>;
}) {
  return (
    <div className={styles.propSection}>
      <h4>{title}</h4>
      {fields.map((field) => (
        <FieldRow
          key={`core:${field.name}`}
          fieldPath={field.name}
          label={field.name}
          value={formatValue(field.value)}
          cppType={field.type}
          hasOverride={false}
          showRevert={false}
          onRevert={() => {}}
        />
      ))}
    </div>
  );
}

function ErrorViewer({ errors }: { errors: string[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <div className={styles.propSection}>
      <h4>Schema/YAML Errors</h4>
      <div style={{ maxHeight: 180, overflowY: "auto", fontSize: 12 }}>
        {errors.map((error, index) => (
          <div key={`${index}:${error}`} style={{ color: "#f3b2b2", marginBottom: 6 }}>
            {error}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "<unset>";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getDisplayValue(value: unknown, registryDefault?: string): string {
  if (value !== undefined) {
    return formatValue(value);
  }
  if (registryDefault !== undefined && registryDefault !== null && registryDefault !== "") {
    return registryDefault;
  }
  return "default not available";
}

function buildValidationErrors(
  workload: {
    type?: string;
    config?: Record<string, unknown>;
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
  },
  schemaStructs: Record<string, WorkloadsRegistryStruct>
): string[] {
  const errors: string[] = [];
  errors.push(
    ...validateSection(
      "config",
      workload.config ?? {},
      getStructByName(schemaStructs, "config")?.fields ?? [],
      schemaStructs
    )
  );
  errors.push(
    ...validateSection(
      "inputs",
      workload.inputs ?? {},
      getStructByName(schemaStructs, "inputs")?.fields ?? [],
      schemaStructs
    )
  );
  errors.push(
    ...validateSection(
      "outputs",
      workload.outputs ?? {},
      getStructByName(schemaStructs, "outputs")?.fields ?? [],
      schemaStructs
    )
  );
  return errors;
}

function validateSection(
  section: "config" | "inputs" | "outputs",
  values: Record<string, unknown>,
  schemaFields: WorkloadsRegistryField[],
  structs: Record<string, WorkloadsRegistryStruct>
): string[] {
  const errors: string[] = [];
  const schemaByName = new Map(schemaFields.map((field) => [field.name, field]));

  for (const [name, value] of Object.entries(values)) {
    const schema = schemaByName.get(name);
    if (!schema) {
      errors.push(`Unknown ${section} field in YAML: '${name}'.`);
      continue;
    }
    validateValueAgainstType(`${section}.${name}`, value, schema.type, structs, errors);
  }

  return errors;
}

function validateValueAgainstType(
  path: string,
  value: unknown,
  cppType: string,
  structs: Record<string, WorkloadsRegistryStruct>,
  errors: string[]
) {
  if (value === null || value === undefined) {
    return;
  }

  const vectorInner = getVectorInnerType(cppType);
  if (vectorInner) {
    if (!Array.isArray(value)) {
      errors.push(`Wrong type for ${path}: expected '${cppType}', got '${typeof value}'.`);
      return;
    }
    value.forEach((item, index) => {
      validateValueAgainstType(`${path}[${index}]`, item, vectorInner, structs, errors);
    });
    return;
  }

  const struct = resolveStructType(structs, cppType);
  if (struct) {
    if (!isPlainObject(value)) {
      errors.push(`Wrong type for ${path}: expected '${cppType}', got '${typeof value}'.`);
      return;
    }
    const byName = new Map((struct.fields ?? []).map((field) => [field.name, field]));
    for (const [name, childValue] of Object.entries(value)) {
      const child = byName.get(name);
      if (!child) {
        errors.push(`Unknown field in YAML at ${path}: '${name}'.`);
        continue;
      }
      validateValueAgainstType(`${path}.${name}`, childValue, child.type, structs, errors);
    }
    return;
  }

  const t = cppType.toLowerCase();
  if (
    t.includes("string") ||
    t.includes("char*") ||
    t.includes("char *") ||
    t.includes("fixedstring")
  ) {
    if (typeof value !== "string") {
      errors.push(`Wrong type for ${path}: expected '${cppType}', got '${typeof value}'.`);
    }
    return;
  }
  if (t.includes("bool")) {
    if (typeof value !== "boolean") {
      errors.push(`Wrong type for ${path}: expected '${cppType}', got '${typeof value}'.`);
    }
    return;
  }
  if (
    t.includes("float") ||
    t.includes("double") ||
    t.includes("int") ||
    t.includes("uint") ||
    t.includes("size_t") ||
    t.includes("long") ||
    t.includes("short")
  ) {
    if (typeof value !== "number") {
      errors.push(`Wrong type for ${path}: expected '${cppType}', got '${typeof value}'.`);
    }
    return;
  }
  if (t.endsWith("[]")) {
    if (!Array.isArray(value)) {
      errors.push(`Wrong type for ${path}: expected '${cppType}', got '${typeof value}'.`);
    }
  }
}

function getStructByName(
  structs: Record<string, WorkloadsRegistryStruct>,
  name: string
): WorkloadsRegistryStruct | undefined {
  return structs[name] ?? structs[name.toLowerCase()] ?? structs[name.toUpperCase()];
}

function resolveStructType(
  structs: Record<string, WorkloadsRegistryStruct>,
  cppType: string
): WorkloadsRegistryStruct | undefined {
  const normalized = cppType.replace(/^const\s+/, "").replace(/\s*[*&]\s*$/, "").trim();
  return structs[normalized] ?? structs[normalized.toLowerCase()] ?? undefined;
}

function getVectorInnerType(cppType: string): string | null {
  const vectorMatch = cppType.match(/vector\s*<\s*([^>]+)\s*>/i);
  if (vectorMatch?.[1]) {
    return vectorMatch[1].trim();
  }
  if (cppType.endsWith("[]")) {
    return cppType.slice(0, -2).trim();
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
