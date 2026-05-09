import React from "react";
import type {
  ITelemetryField,
} from "../../../../data-sources/telemetry";
import sharedStyles from "../Telemetry.module.css";
import treeStyles from "../tree-viewer/TelemetryTreeViewer.module.css";
import { spawnTelemetryImagePanel } from "../panels";
import {
  formatEnumArrayPreview,
  formatEnumNumber,
} from "../utils/telemetry-formatters";
import { extractTelemetryImagePayload } from "../utils/telemetry-image";
import type { FieldConnectionHint } from "./types";
import { WritableTelemetryInputField } from "./WritableTelemetryInputField";
import {
  type ConnectionKind,
  getConnectionHint,
  getConnectionKindFromHint,
  getConnectionTooltip,
} from "./field-connections";

const DEFAULT_ARRAY_PAGE_SIZE = 64;

type ReadValue = (field: ITelemetryField) => unknown;

export type TelemetryFieldTreeContext = {
  workloadName?: string;
  sectionKind?: string;
  depth: number;
};

type TelemetryFieldTreeProps = {
  fields: ITelemetryField[];
  className?: string;
  telemetryBaseUrl?: string;
  panelScope?: string;
  modelName?: string;
  fieldConnectionHints?: ReadonlyMap<string, FieldConnectionHint>;
  expandedPaths?: ReadonlySet<string>;
  onTogglePath?: (path: string) => void;
  defaultExpandedPaths?: Iterable<string>;
  getArrayVisibleCount?: (path: string, total: number) => number;
  onShowNextArrayPage?: (path: string, total: number) => void;
  arrayPageSize?: number;
  onFieldTextContextMenu?: (
    field: ITelemetryField,
    context: TelemetryFieldTreeContext,
    event: React.MouseEvent<HTMLElement>
  ) => void;
};

type TelemetryFieldTreeRuntimeProviderProps = {
  sampleRevision: number;
  readValue: ReadValue;
  children: React.ReactNode;
};

const TelemetryFieldTreeSampleRevisionContext = React.createContext(0);
const TelemetryFieldTreeValueReaderContext = React.createContext<ReadValue | null>(
  null
);

function getConnectionCapsuleClass(kind: ConnectionKind | null): string {
  if (kind === "local") return sharedStyles.localConnectedCapsule;
  if (kind === "remote") return sharedStyles.remoteConnectedCapsule;
  if (kind === "both") return sharedStyles.bothConnectedCapsule;
  return "";
}

function isSectionKind(value?: string): boolean {
  return (
    value === "config" ||
    value === "inputs" ||
    value === "outputs" ||
    value === "stats"
  );
}

function formatFieldValue(field: ITelemetryField, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "bigint") {
    return formatEnumNumber(field, value);
  }
  if (Array.isArray(value)) {
    if (field.enum_values && field.enum_values.length > 0) {
      return formatEnumArrayPreview(field, value);
    }
    return `[${value.length} items]`;
  }
  if (value instanceof Uint8Array) return `<bytes ${value.byteLength}>`;
  if (typeof value === "object") return "{…}";
  return String(value);
}

function formatArraySummary(value: unknown): string {
  if (!Array.isArray(value)) return "[]";
  return `[${value.length} items]`;
}

function formatNodeSummary(field: ITelemetryField, hasChildren: boolean): string {
  const imagePayload = extractTelemetryImagePayload(field);
  if (imagePayload) {
    return `<image ${imagePayload.bytes.byteLength} bytes>`;
  }
  if (field.elementCount > 1) {
    return `[${field.elementCount} items]`;
  }
  if (!hasChildren) {
    return "";
  }
  const fieldCount = field.fields?.length ?? 0;
  return fieldCount > 0 ? `{${fieldCount} fields}` : "{…}";
}

function useTelemetryValueReader(): ReadValue {
  const reader = React.useContext(TelemetryFieldTreeValueReaderContext);
  return reader ?? ((field: ITelemetryField) => field.getValue?.());
}

function deriveChildContext(
  field: ITelemetryField,
  parentContext: TelemetryFieldTreeContext
): TelemetryFieldTreeContext {
  if (field.type === "workload") {
    return {
      workloadName: field.name,
      sectionKind: undefined,
      depth: parentContext.depth + 1,
    };
  }
  const sectionKind = isSectionKind(field.type)
    ? field.type
    : parentContext.sectionKind;
  const workloadName =
    parentContext.workloadName ??
    (field.path.includes(".") ? field.path.split(".")[0] : undefined);
  return {
    workloadName,
    sectionKind,
    depth: parentContext.depth + 1,
  };
}

function getWorkloadNameForField(field: ITelemetryField): string | undefined {
  if (field.type === "workload") {
    return field.name;
  }
  if (field.path.includes(".")) {
    return field.path.split(".")[0];
  }
  return undefined;
}

function useTreeState(
  defaultExpandedPaths: Iterable<string> | undefined,
  arrayPageSize: number,
  externalExpandedPaths?: ReadonlySet<string>,
  externalTogglePath?: (path: string) => void,
  externalGetArrayVisibleCount?: (path: string, total: number) => number,
  externalShowNextArrayPage?: (path: string, total: number) => void
) {
  const [internalExpandedPaths, setInternalExpandedPaths] = React.useState(
    () => new Set(defaultExpandedPaths ?? [])
  );
  const [arrayVisibleCounts, setArrayVisibleCounts] = React.useState<
    Record<string, number>
  >({});

  const expandedPaths = externalExpandedPaths ?? internalExpandedPaths;
  const togglePath = React.useCallback(
    (path: string) => {
      if (externalTogglePath) {
        externalTogglePath(path);
        return;
      }
      setInternalExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    },
    [externalTogglePath]
  );

  const getArrayVisibleCount = React.useCallback(
    (path: string, total: number) => {
      if (externalGetArrayVisibleCount) {
        return externalGetArrayVisibleCount(path, total);
      }
      if (total <= 0) return 0;
      const configured = arrayVisibleCounts[path] ?? arrayPageSize;
      return Math.max(1, Math.min(total, configured));
    },
    [arrayPageSize, arrayVisibleCounts, externalGetArrayVisibleCount]
  );

  const showNextArrayPage = React.useCallback(
    (path: string, total: number) => {
      if (externalShowNextArrayPage) {
        externalShowNextArrayPage(path, total);
        return;
      }
      setArrayVisibleCounts((prev) => {
        const current = prev[path] ?? arrayPageSize;
        const next = Math.min(total, current + arrayPageSize);
        if (next === current) return prev;
        return { ...prev, [path]: next };
      });
    },
    [arrayPageSize, externalShowNextArrayPage]
  );

  return {
    expandedPaths,
    togglePath,
    getArrayVisibleCount,
    showNextArrayPage,
  };
}

function TreeNodeValue({
  field,
  isArrayField,
  hasChildren,
}: {
  field: ITelemetryField;
  isArrayField: boolean;
  hasChildren: boolean;
}) {
  React.useContext(TelemetryFieldTreeSampleRevisionContext);
  const readValue = useTelemetryValueReader();
  const value = hasChildren
    ? formatNodeSummary(field, hasChildren)
    : formatFieldValue(field, readValue(field));
  return (
    <span className={treeStyles.nodeValue}>
      {hasChildren ? value : isArrayField ? formatArraySummary(value) : value}
    </span>
  );
}

function WritableTreeNodeField({
  field,
  telemetryBaseUrl,
  capsuleClassName,
  tooltipText,
  onTextContextMenu,
}: {
  field: ITelemetryField;
  telemetryBaseUrl?: string;
  capsuleClassName?: string;
  tooltipText?: string | null;
  onTextContextMenu?: React.MouseEventHandler<HTMLElement>;
}) {
  React.useContext(TelemetryFieldTreeSampleRevisionContext);
  const readValue = useTelemetryValueReader();
  return (
    <WritableTelemetryInputField
      field={field}
      telemetryBaseUrl={telemetryBaseUrl}
      className={treeStyles.writableNodeEntry}
      capsuleClassName={capsuleClassName}
      tooltipText={tooltipText}
      labelContextMenu={onTextContextMenu}
      readCurrentValue={readValue}
      formatCurrentValue={(targetField) =>
        formatFieldValue(targetField, readValue(targetField))
      }
    />
  );
}

type TelemetryFieldTreeNodeProps = {
  field: ITelemetryField;
  context: TelemetryFieldTreeContext;
  telemetryBaseUrl?: string;
  panelScope: string;
  modelName?: string;
  fieldConnectionHints?: ReadonlyMap<string, FieldConnectionHint>;
  expandedPaths: ReadonlySet<string>;
  togglePath: (path: string) => void;
  getArrayVisibleCount: (path: string, total: number) => number;
  showNextArrayPage: (path: string, total: number) => void;
  arrayPageSize: number;
  onFieldTextContextMenu?: (
    field: ITelemetryField,
    context: TelemetryFieldTreeContext,
    event: React.MouseEvent<HTMLElement>
  ) => void;
};

const TelemetryFieldTreeNode = React.memo(function TelemetryFieldTreeNode({
  field,
  context,
  telemetryBaseUrl,
  panelScope,
  modelName,
  fieldConnectionHints,
  expandedPaths,
  togglePath,
  getArrayVisibleCount,
  showNextArrayPage,
  arrayPageSize,
  onFieldTextContextMenu,
}: TelemetryFieldTreeNodeProps) {
  const isArrayField = field.elementCount > 1;
  const hasChildren = isArrayField || Boolean(field.fields?.length);
  const imagePayload = extractTelemetryImagePayload(field);
  const readValue = useTelemetryValueReader();
  const fieldValue = readValue(field);
  const isImageBufferField =
    field.name === "data_buffer" &&
    (Boolean(imagePayload) ||
      fieldValue instanceof Uint8Array ||
      field.path.toLowerCase().includes(".image.data_buffer"));
  const showChildren = hasChildren && !isImageBufferField;
  const expanded = expandedPaths.has(field.path);
  const connectionHint = getConnectionHint(field.path, fieldConnectionHints);
  const connectionKind = getConnectionKindFromHint(connectionHint);
  const capsuleClass = getConnectionCapsuleClass(connectionKind);
  const tooltipText = getConnectionTooltip(field.path, connectionHint);
  const workloadName =
    context.workloadName ?? getWorkloadNameForField(field);
  const isWritableInput =
    typeof field.writable_input_handle === "number" &&
    field.path.includes(".inputs.") &&
    !hasChildren;
  const handleOpenImagePanel = (event: React.MouseEvent) => {
    event.stopPropagation();
    spawnTelemetryImagePanel({
      scope: panelScope,
      settings: {
        panelTitle: field.path,
        telemetryBaseUrl,
        workloadName,
        modelName,
        fieldPath: field.path,
      },
    });
  };
  const handleTextContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (!onFieldTextContextMenu) {
      return;
    }
    onFieldTextContextMenu(field, context, event);
  };
  const childContext = deriveChildContext(field, context);
  const arrayTotalCount = field.elementCount;
  const arrayVisibleCount = isArrayField
    ? getArrayVisibleCount(field.path, arrayTotalCount)
    : 0;
  const arrayChildren = React.useMemo(
    () =>
      isArrayField
        ? Array.from({ length: arrayVisibleCount }, (_, index) =>
            field.getArrayElement?.(index)
          ).filter((entry): entry is ITelemetryField => Boolean(entry))
        : [],
    [arrayVisibleCount, field, isArrayField]
  );

  return (
    <div className={treeStyles.node}>
      <div className={treeStyles.nodeRow}>
        {showChildren ? (
          <button
            type="button"
            className={treeStyles.nodeToggle}
            onClick={() => togglePath(field.path)}
          >
            {expanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className={treeStyles.nodeToggleSpacer} aria-hidden="true" />
        )}
        {isWritableInput ? (
          <WritableTreeNodeField
            field={field}
            telemetryBaseUrl={telemetryBaseUrl}
            capsuleClassName={capsuleClass}
            tooltipText={tooltipText}
            onTextContextMenu={handleTextContextMenu}
          />
        ) : (
          <span
            className={`${treeStyles.nodeEntry} ${capsuleClass}`.trim()}
            title={tooltipText ?? undefined}
          >
            <span
              className={treeStyles.nodeText}
              data-testid="telemetry-tree-node-text"
              onContextMenu={handleTextContextMenu}
            >
              <span>{field.name}:</span>{" "}
              {isImageBufferField ? (
                <button
                  type="button"
                  className={sharedStyles.telemetryInlineButton}
                  onClick={handleOpenImagePanel}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  Open image panel
                </button>
              ) : (
                <TreeNodeValue
                  field={field}
                  isArrayField={isArrayField}
                  hasChildren={hasChildren}
                />
              )}
            </span>
          </span>
        )}
      </div>
      {showChildren && expanded ? (
        <div className={treeStyles.nodeChildren}>
          {isArrayField
            ? arrayChildren.map((entry) => (
                <TelemetryFieldTreeNode
                  key={entry.path}
                  field={entry}
                  context={childContext}
                  telemetryBaseUrl={telemetryBaseUrl}
                  panelScope={panelScope}
                  modelName={modelName}
                  fieldConnectionHints={fieldConnectionHints}
                  expandedPaths={expandedPaths}
                  togglePath={togglePath}
                  getArrayVisibleCount={getArrayVisibleCount}
                  showNextArrayPage={showNextArrayPage}
                  arrayPageSize={arrayPageSize}
                  onFieldTextContextMenu={onFieldTextContextMenu}
                />
              ))
            : field.fields?.map((child) => (
                <TelemetryFieldTreeNode
                  key={child.path}
                  field={child}
                  context={childContext}
                  telemetryBaseUrl={telemetryBaseUrl}
                  panelScope={panelScope}
                  modelName={modelName}
                  fieldConnectionHints={fieldConnectionHints}
                  expandedPaths={expandedPaths}
                  togglePath={togglePath}
                  getArrayVisibleCount={getArrayVisibleCount}
                  showNextArrayPage={showNextArrayPage}
                  arrayPageSize={arrayPageSize}
                  onFieldTextContextMenu={onFieldTextContextMenu}
                />
              ))}
          {isArrayField && arrayVisibleCount < arrayTotalCount ? (
            <div className={treeStyles.node}>
              <button
                type="button"
                className={sharedStyles.telemetryInlineButton}
                onClick={() => showNextArrayPage(field.path, arrayTotalCount)}
              >
                Show next {arrayPageSize} ({arrayVisibleCount}/{arrayTotalCount})
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export function TelemetryFieldTreeRuntimeProvider({
  sampleRevision,
  readValue,
  children,
}: TelemetryFieldTreeRuntimeProviderProps) {
  return (
    <TelemetryFieldTreeSampleRevisionContext.Provider value={sampleRevision}>
      <TelemetryFieldTreeValueReaderContext.Provider value={readValue}>
        {children}
      </TelemetryFieldTreeValueReaderContext.Provider>
    </TelemetryFieldTreeSampleRevisionContext.Provider>
  );
}

export function TelemetryFieldTree({
  fields,
  className,
  telemetryBaseUrl,
  panelScope,
  modelName,
  fieldConnectionHints,
  expandedPaths,
  onTogglePath,
  defaultExpandedPaths,
  getArrayVisibleCount,
  onShowNextArrayPage,
  arrayPageSize = DEFAULT_ARRAY_PAGE_SIZE,
  onFieldTextContextMenu,
}: TelemetryFieldTreeProps) {
  const floatingScope = panelScope ?? "global-floating-panels";
  const treeState = useTreeState(
    defaultExpandedPaths,
    arrayPageSize,
    expandedPaths,
    onTogglePath,
    getArrayVisibleCount,
    onShowNextArrayPage
  );

  if (fields.length === 0) {
    return <div className={treeStyles.message}>No telemetry fields available.</div>;
  }

  return (
    <div
      className={
        className ? `${treeStyles.treeRows} ${className}` : treeStyles.treeRows
      }
    >
      {fields.map((field) => (
        <div
          key={field.path}
          className={treeStyles.treeRow}
          data-testid="telemetry-tree-row"
        >
          <TelemetryFieldTreeNode
            field={field}
            context={{ depth: 0 }}
            telemetryBaseUrl={telemetryBaseUrl}
            panelScope={floatingScope}
            modelName={modelName}
            fieldConnectionHints={fieldConnectionHints}
            expandedPaths={treeState.expandedPaths}
            togglePath={treeState.togglePath}
            getArrayVisibleCount={treeState.getArrayVisibleCount}
            showNextArrayPage={treeState.showNextArrayPage}
            arrayPageSize={arrayPageSize}
            onFieldTextContextMenu={onFieldTextContextMenu}
          />
        </div>
      ))}
    </div>
  );
}
