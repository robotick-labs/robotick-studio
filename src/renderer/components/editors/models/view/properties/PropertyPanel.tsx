import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  launcherService,
  type WorkloadsRegistryField,
  type WorkloadsRegistryResponse,
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
  byType: Map<string, ResolvedWorkloadSchema>;
  validationErrors: string[];
  coreSchema: Record<string, unknown> | null;
};

type CachedSchema = {
  byType: Map<string, ResolvedWorkloadSchema>;
  validationErrors: string[];
  coreSchema: Record<string, unknown> | null;
  loadedAtMs: number;
};

type ResolvedWorkloadSchema = {
  type: string;
  roots: Partial<Record<WorkloadSection, string>>;
  structs: Record<string, WorkloadsRegistryStruct>;
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
    validationErrors: [],
    coreSchema: null,
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
          validationErrors: cached.validationErrors,
          coreSchema: cached.coreSchema,
        });
        return;
      }

      setSchemaState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const response = await launcherService.fetchProjectWorkloadsRegistry(
          projectPath,
          "linux"
        );
        const { byType, validationErrors } =
          buildSchemasFromRegistryResponse(response);
        const coreSchema = await launcherService.fetchProjectCoreModelSchema(
          projectPath,
          "linux"
        );
        SCHEMA_CACHE.set(cacheKey, {
          byType,
          validationErrors,
          coreSchema,
          loadedAtMs: Date.now(),
        });
        setSchemaState({
          loading: false,
          error: null,
          byType,
          validationErrors,
          coreSchema,
        });
      } catch (error) {
        setSchemaState((prev) => ({
          ...prev,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load workload schema metadata",
          validationErrors: prev.validationErrors,
          coreSchema: prev.coreSchema,
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
    if (!base || !wname || wname === "__model__") {
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

  const selectedModel = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    const [base, localId] = selectedId.split(":", 2);
    if (!base || localId !== "__model__") {
      return null;
    }
    for (const [modelId, model] of store.entries()) {
      const modelBase = modelId
        .split("/")
        .pop()
        ?.replace(/\.model\.yaml$/, "");
      if (modelBase === base) {
        return { modelId, model };
      }
    }
    return null;
  }, [selectedId, store]);

  if (!selectedWorkload && !selectedModel) {
    return (
      <div>
        <PanelHeader
          loading={schemaState.loading}
          onRefresh={() => void loadSchema(true)}
        />
        <p>Select a workload node to inspect schema-backed properties.</p>
        <ErrorViewer errors={[]} />
      </div>
    );
  }

  if (selectedModel) {
    const { modelId, model } = selectedModel;
    const modelName =
      typeof model.name === "string" && model.name.trim()
        ? model.name
        : modelId.split("/").pop()?.replace(/\.model\.yaml$/, "") ?? modelId;
    return (
      <div>
        <PanelHeader
          loading={schemaState.loading}
          onRefresh={() => void loadSchema(true)}
        />
        <h3>
          <span>Model</span>{" "}
          <span style={{ fontWeight: "normal" }}>| {modelName}</span>
        </h3>

        <ModelSchemaSection
          title="Properties"
          value={model as Record<string, unknown>}
          schema={schemaState.coreSchema}
          path="$"
        />

        <ErrorViewer errors={schemaState.error ? [schemaState.error] : []} />
      </div>
    );
  }

  const { modelId, workload } = selectedWorkload!;
  const workloadType = workload.type?.trim() ?? "";
  const schemaEntry = workloadType
    ? schemaState.byType.get(workloadType)
    : undefined;
  const awaitingSchema = schemaState.loading && !schemaEntry;
  const schemaStructs = schemaEntry?.structs ?? {};
  const configFields = resolveSectionSchemaFields(schemaEntry, "config");
  const inputsFields = resolveSectionSchemaFields(schemaEntry, "inputs");
  const outputsFields = resolveSectionSchemaFields(schemaEntry, "outputs");

  const validationErrors = awaitingSchema
    ? []
    : buildValidationErrors(
        workload,
        schemaStructs,
        configFields,
        inputsFields,
        outputsFields
      );
  const fetchErrors = schemaState.error ? [schemaState.error] : [];
  const launcherValidationErrors = schemaState.validationErrors;
  const missingSchemaError =
    workloadType && !schemaEntry && !schemaState.loading
      ? [`No workload schema metadata found for type '${workloadType}'.`]
      : [];
  const allErrors = [
    ...fetchErrors,
    ...launcherValidationErrors,
    ...missingSchemaError,
    ...validationErrors,
  ];

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

      {awaitingSchema ? (
        <CollapsibleSection title="Loading">
          <div className={styles.propLoadingWrap} aria-label="Loading schema metadata">
            <div className={styles.propLoadingDots} aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </div>
          </div>
        </CollapsibleSection>
      ) : (
        <>
          <SchemaSection
            title="Config"
            schemaFields={configFields}
            structs={schemaStructs}
            values={workload.config ?? {}}
            readOnly={true}
            onRevert={(fieldPath) =>
              store.clearWorkloadFieldOverride(
                modelId,
                workload.name,
                "config",
                fieldPath
              )
            }
          />
          <SchemaSection
            title="Inputs"
            schemaFields={inputsFields}
            structs={schemaStructs}
            values={workload.inputs ?? {}}
            readOnly={true}
            onRevert={(fieldPath) =>
              store.clearWorkloadFieldOverride(
                modelId,
                workload.name,
                "inputs",
                fieldPath
              )
            }
          />
          <SchemaSection
            title="Outputs"
            schemaFields={outputsFields}
            structs={schemaStructs}
            values={workload.outputs ?? {}}
            readOnly={true}
            onRevert={(fieldPath) =>
              store.clearWorkloadFieldOverride(
                modelId,
                workload.name,
                "outputs",
                fieldPath
              )
            }
          />
        </>
      )}

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
        {loading ? (
          <span className={styles.propButtonLoadingDots} aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        ) : (
          "Refresh metadata"
        )}
      </button>
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className={styles.propSection} open>
      <summary className={styles.propSectionSummary}>
        <h4 className={styles.propSectionHeading}>{title}</h4>
      </summary>
      <div>{children}</div>
    </details>
  );
}

function SchemaSection({
  title,
  schemaFields,
  structs,
  values,
  readOnly,
  onRevert,
}: {
  title: string;
  schemaFields: WorkloadsRegistryField[];
  structs: Record<string, WorkloadsRegistryStruct>;
  values: Record<string, unknown>;
  readOnly: boolean;
  onRevert: (fieldPath: string) => void;
}) {
  if (schemaFields.length === 0) {
    return (
      <CollapsibleSection title={title}>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>No fields discovered</p>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection title={title}>
      {schemaFields.map((field) => {
        const hasOverride = Object.prototype.hasOwnProperty.call(values, field.name);
        const rawValue = values[field.name];
        const display = getDisplayValue(rawValue, field.default);
        const nestedStruct = resolveStructType(structs, field.type);
        return (
          <div key={`${title}:${field.name}`} style={{ marginBottom: 8 }}>
            {nestedStruct ? (
              <CompositeFieldGroup
                label={field.name}
                cppType={field.type}
                fieldPath={field.name}
                hasOverride={hasOverride}
                readOnly={readOnly}
                onRevert={() => onRevert(field.name)}
              >
                <NestedStructFields
                  path={field.name}
                  struct={nestedStruct}
                  structs={structs}
                  value={rawValue}
                  readOnly={readOnly}
                  onRevert={onRevert}
                />
              </CompositeFieldGroup>
            ) : (
              <FieldRow
                fieldPath={field.name}
                label={field.name}
                value={display}
                cppType={field.type}
                hasOverride={hasOverride}
                showRevert={true}
                readOnly={readOnly}
                onRevert={() => onRevert(field.name)}
              />
            )}
          </div>
        );
      })}
    </CollapsibleSection>
  );
}

function NestedStructFields({
  path,
  struct,
  structs,
  value,
  readOnly,
  onRevert,
}: {
  path: string;
  struct: WorkloadsRegistryStruct;
  structs: Record<string, WorkloadsRegistryStruct>;
  value: unknown;
  readOnly: boolean;
  onRevert: (fieldPath: string) => void;
}) {
  if (!Array.isArray(struct.fields) || struct.fields.length === 0) {
    return null;
  }
  const objectValue = isPlainObject(value) ? value : ({} as Record<string, unknown>);

  return (
    <div style={{ marginLeft: 12, marginTop: 6 }}>
      {struct.fields.map((field) => {
        const childPath = `${path}.${field.name}`;
        const hasOverride = Object.prototype.hasOwnProperty.call(objectValue, field.name);
        const childValue = objectValue[field.name];
        const display = getDisplayValue(childValue, field.default);
        const childStruct = resolveStructType(structs, field.type);
        return (
          <div key={childPath} style={{ marginBottom: 6 }}>
            {childStruct ? (
              <CompositeFieldGroup
                label={childPath}
                cppType={field.type}
                fieldPath={childPath}
                hasOverride={hasOverride}
                readOnly={readOnly}
                onRevert={() => onRevert(childPath)}
              >
                <NestedStructFields
                  path={childPath}
                  struct={childStruct}
                  structs={structs}
                  value={childValue}
                  readOnly={readOnly}
                  onRevert={onRevert}
                />
              </CompositeFieldGroup>
            ) : (
              <FieldRow
                fieldPath={childPath}
                label={childPath}
                value={display}
                cppType={field.type}
                hasOverride={hasOverride}
                showRevert={true}
                readOnly={readOnly}
                onRevert={() => onRevert(childPath)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CompositeFieldGroup({
  label,
  cppType,
  fieldPath,
  hasOverride,
  readOnly,
  onRevert,
  children,
}: {
  label: string;
  cppType: string;
  fieldPath: string;
  hasOverride: boolean;
  readOnly: boolean;
  onRevert: () => void;
  children: React.ReactNode;
}) {
  return (
    <details className={styles.propComposite} open>
      <summary className={styles.propCompositeSummary}>
        <div className={styles.propRow}>
          <div className={styles.propLabel} title={fieldPath}>
            {label}
          </div>
          <div style={{ opacity: 0.75, fontSize: "0.8em" }} title={cppType}>
            {cppType}
          </div>
          <button
            type="button"
            className={`${styles.propRevert} ${hasOverride ? "" : styles.propRevertGhost}`.trim()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRevert();
            }}
            disabled={readOnly || !hasOverride}
            aria-label={`Revert ${fieldPath}`}
            title={`Revert ${fieldPath}`}
          >
            {hasOverride ? "↺" : ""}
          </button>
        </div>
      </summary>
      <div className={styles.propCompositeBody}>{children}</div>
    </details>
  );
}

function FieldRow({
  fieldPath,
  label,
  value,
  cppType,
  hasOverride,
  showRevert,
  readOnly,
  onRevert,
}: {
  fieldPath: string;
  label: string;
  value: string;
  cppType: string;
  hasOverride: boolean;
  showRevert: boolean;
  readOnly: boolean;
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
          className={`${styles.propRevert} ${hasOverride ? "" : styles.propRevertGhost}`.trim()}
          onClick={onRevert}
          disabled={readOnly || !hasOverride}
          aria-label={`Revert ${fieldPath}`}
          title={`Revert ${fieldPath}`}
        >
          {hasOverride ? "↺" : ""}
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
    <CollapsibleSection title={title}>
      {fields.map((field) => (
        <FieldRow
          key={`core:${field.name}`}
          fieldPath={field.name}
          label={field.name}
          value={formatValue(field.value)}
          cppType={field.type}
          hasOverride={false}
          showRevert={false}
          readOnly={true}
          onRevert={() => {}}
        />
      ))}
    </CollapsibleSection>
  );
}

function ModelSchemaSection({
  title,
  value,
  schema,
  path,
}: {
  title: string;
  value: unknown;
  schema: Record<string, unknown> | null;
  path: string;
}) {
  return (
    <CollapsibleSection title={title}>
      <ModelValueNode
        label={path}
        value={value}
        schema={schema}
        path={path}
        collapseComposite={false}
      />
    </CollapsibleSection>
  );
}

function ModelValueNode({
  label,
  value,
  schema,
  path,
  collapseComposite = false,
}: {
  label: string;
  value: unknown;
  schema: Record<string, unknown> | null;
  path: string;
  collapseComposite?: boolean;
}) {
  const schemaType = inferSchemaType(schema);
  if (isPlainObject(value) || schemaType === "object") {
    const objectValue = isPlainObject(value) ? value : {};
    const schemaProperties =
      schema && isPlainObject(schema.properties)
        ? (schema.properties as Record<string, unknown>)
        : {};

    const orderedKeys: string[] = [];
    for (const key of Object.keys(schemaProperties)) {
      if (key in objectValue) orderedKeys.push(key);
    }
    for (const key of Object.keys(objectValue)) {
      if (!orderedKeys.includes(key)) orderedKeys.push(key);
    }

    const isArrayItemLabel = /^\[\d+\]$/.test(label);
    const nameDisplay =
      isArrayItemLabel && isPlainObject(value) && typeof value.name === "string"
        ? value.name
        : "";

    if (path === "$") {
      return (
        <div>
          {orderedKeys.map((key) => (
            <ModelObjectChild
              key={`${path}.${key}`}
              keyName={key}
              value={objectValue[key]}
              schema={
                isPlainObject(schemaProperties[key])
                  ? (schemaProperties[key] as Record<string, unknown>)
                  : null
              }
              path={`${path}.${key}`}
            />
          ))}
        </div>
      );
    }

    return (
      <details className={styles.propComposite} open={!collapseComposite}>
        <summary className={styles.propCompositeSummary}>
          <div className={styles.propRow}>
            <div className={styles.propLabel} title={path}>
              {label}
            </div>
            <div style={{ opacity: 0.75, fontSize: "0.8em" }}>
              {nameDisplay}
            </div>
            <span />
          </div>
        </summary>
        <div className={styles.propCompositeBody}>
          {orderedKeys.map((key) => (
            <ModelObjectChild
              key={`${path}.${key}`}
              keyName={key}
              value={objectValue[key]}
              schema={
                isPlainObject(schemaProperties[key])
                  ? (schemaProperties[key] as Record<string, unknown>)
                  : null
              }
              path={`${path}.${key}`}
              collapseComposite={collapseComposite}
            />
          ))}
        </div>
      </details>
    );
  }

  if (Array.isArray(value)) {
    const itemSchema =
      schema && isPlainObject(schema.items)
        ? (schema.items as Record<string, unknown>)
        : null;
    const arrayLabel = `${value.length} items`;
    if (value.length === 0) {
      return (
        <FieldRow
          fieldPath={path}
          label={label}
          value={arrayLabel}
          cppType="array"
          hasOverride={false}
          showRevert={false}
          readOnly={true}
          onRevert={() => {}}
        />
      );
    }
    return (
      <details className={styles.propComposite}>
        <summary className={styles.propCompositeSummary}>
          <div className={styles.propRow}>
            <div className={styles.propLabel} title={path}>
              {label}
            </div>
            <div style={{ opacity: 0.75, fontSize: "0.8em" }} title="array">
              {arrayLabel}
            </div>
            <span />
          </div>
        </summary>
        <div className={styles.propCompositeBody}>
          {value.map((item, index) => (
            <ModelValueNode
              key={`${path}[${index}]`}
              label={`[${index}]`}
              value={item}
              schema={itemSchema}
              path={`${path}[${index}]`}
              collapseComposite={true}
            />
          ))}
        </div>
      </details>
    );
  }

  return (
    <FieldRow
      fieldPath={path}
      label={label}
      value={formatValue(value)}
      cppType={schemaType}
      hasOverride={false}
      showRevert={false}
      readOnly={true}
      onRevert={() => {}}
    />
  );
}

function ModelObjectChild({
  keyName,
  value,
  schema,
  path,
  collapseComposite = false,
}: {
  keyName: string;
  value: unknown;
  schema: Record<string, unknown> | null;
  path: string;
  collapseComposite?: boolean;
}) {
  return (
    <ModelValueNode
      label={keyName}
      value={value}
      schema={schema}
      path={path}
      collapseComposite={collapseComposite}
    />
  );
}

function buildObjectFields(
  objectValue: Record<string, unknown>
): Array<{ name: string; type: string; value: unknown }> {
  return Object.entries(objectValue)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({
      name,
      type: inferDisplayType(value),
      value,
    }));
}

function buildModelCoreFieldsFromSchema(
  model: Record<string, unknown>,
  coreSchema: Record<string, unknown> | null,
  modelId: string
): Array<{ name: string; type: string; value: unknown }> {
  const fromSchema: Array<{ name: string; type: string; value: unknown }> = [];
  const schemaProperties =
    coreSchema && isPlainObject(coreSchema.properties)
      ? (coreSchema.properties as Record<string, unknown>)
      : null;
  if (schemaProperties) {
    for (const [name, schemaNode] of Object.entries(schemaProperties)) {
      if (!Object.prototype.hasOwnProperty.call(model, name)) continue;
      fromSchema.push({
        name,
        type: inferSchemaType(schemaNode),
        value: model[name],
      });
    }
  }
  fromSchema.push({
    name: "file",
    type: "path",
    value: modelId,
  });
  return fromSchema;
}

function inferSchemaType(schemaNode: unknown): string {
  if (!isPlainObject(schemaNode)) return "unknown";
  const t = schemaNode.type;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.join("|");
  return "unknown";
}

function inferDisplayType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function ErrorViewer({ errors }: { errors: string[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <CollapsibleSection title="Schema/YAML Errors">
      <div style={{ maxHeight: 180, overflowY: "auto", fontSize: 12 }}>
        {errors.map((error, index) => (
          <div key={`${index}:${error}`} style={{ color: "#f3b2b2", marginBottom: 6 }}>
            {error}
          </div>
        ))}
      </div>
    </CollapsibleSection>
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
  if (registryDefault !== undefined && registryDefault !== null) {
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
  schemaStructs: Record<string, WorkloadsRegistryStruct>,
  configFields: WorkloadsRegistryField[],
  inputsFields: WorkloadsRegistryField[],
  outputsFields: WorkloadsRegistryField[]
): string[] {
  const errors: string[] = [];
  errors.push(
    ...validateSection(
      "config",
      workload.config ?? {},
      configFields,
      schemaStructs
    )
  );
  errors.push(
    ...validateSection(
      "inputs",
      workload.inputs ?? {},
      inputsFields,
      schemaStructs
    )
  );
  errors.push(
    ...validateSection(
      "outputs",
      workload.outputs ?? {},
      outputsFields,
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

function resolveSectionSchemaFields(
  schemaEntry: ResolvedWorkloadSchema | undefined,
  section: WorkloadSection
): WorkloadsRegistryField[] {
  if (!schemaEntry) return [];
  const rootType = schemaEntry.roots[section];
  if (!rootType) return [];
  const struct = resolveStructType(schemaEntry.structs, rootType);
  return struct?.fields ?? [];
}

function buildSchemasFromRegistryResponse(
  response: WorkloadsRegistryResponse
): {
  byType: Map<string, ResolvedWorkloadSchema>;
  validationErrors: string[];
} {
  const byType = new Map<string, ResolvedWorkloadSchema>();
  const globalStructs: Record<string, WorkloadsRegistryStruct> = {};

  for (const typeEntry of response.types ?? []) {
    if (!typeEntry?.name?.trim() || !Array.isArray(typeEntry.fields)) {
      continue;
    }
    globalStructs[typeEntry.name] = {
      name: typeEntry.name,
      fields: typeEntry.fields.map((field) => ({
        name: field.name,
        type: field.type,
        default: field.default_value,
        element_count: field.element_count,
      })),
    };
  }

  const sharedStructs = response.shared_types?.structs ?? {};
  for (const [typeName, struct] of Object.entries(sharedStructs)) {
    if (!typeName?.trim()) continue;
    globalStructs[typeName] = {
      name: struct.type_name ?? typeName,
      fields: (struct.fields ?? []).map((field) => ({
        name: field.field_name,
        type: field.field_type_name,
        default: field.default_value,
      })),
    };
  }

  for (const workloadEntry of response.workloads ?? []) {
    if (!workloadEntry?.type?.trim()) continue;
    byType.set(workloadEntry.type, {
      type: workloadEntry.type,
      roots: {
        config: workloadEntry.config?.type,
        inputs: workloadEntry.inputs?.type,
        outputs: workloadEntry.outputs?.type,
      },
      structs: globalStructs,
    });
  }

  for (const legacy of response.registry ?? []) {
    if (!legacy.type?.trim()) continue;
    const legacyStructs = legacy.metadata?.structs ?? {};
    const mergedStructs: Record<string, WorkloadsRegistryStruct> = {
      ...globalStructs,
      ...legacyStructs,
    };
    const prior = byType.get(legacy.type);
    byType.set(legacy.type, {
      type: legacy.type,
      roots: {
        config:
          prior?.roots.config ??
          legacyStructs.config?.name ??
          "config",
        inputs:
          prior?.roots.inputs ??
          legacyStructs.inputs?.name ??
          "inputs",
        outputs:
          prior?.roots.outputs ??
          legacyStructs.outputs?.name ??
          "outputs",
      },
      structs: mergedStructs,
    });
  }

  return {
    byType,
    validationErrors: response.validation_errors ?? [],
  };
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
