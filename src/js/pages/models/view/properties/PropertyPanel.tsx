import React from "react";
import { editorState } from "../../controllers/editorState";
import { GraphDoc } from "../node-graph/editorNodeGraph";

type PropertyPanelProps = {
  doc: GraphDoc;
};

export const PropertyPanel: React.FC<PropertyPanelProps> = ({ doc }) => {
  const id = editorState.selection;
  const node = id ? doc.getNode(id) : null;
  const workload = node?.workload;

  if (!node || node.kind !== "workload" || !workload) {
    return (
      <div>
        <h3>Properties</h3>
      </div>
    );
  }

  return (
    <div>
      <h3>
        Properties{" "}
        <span style={{ fontWeight: "normal" }}>| {workload.type}</span>
      </h3>

      <PropertySection
        title="Core"
        fields={{
          name: workload.name,
          type: workload.type ?? "",
          tick_rate_hz: workload.tick_rate_hz?.toString() ?? "60",
        }}
      />

      {workload.config && (
        <PropertySection title="Config" fields={workload.config} />
      )}

      {workload.inputs && (
        <PropertySection title="Inputs" fields={workload.inputs} />
      )}
    </div>
  );
};

type PropertySectionProps = {
  title: string;
  fields: Record<string, string>;
};

const PropertySection: React.FC<PropertySectionProps> = ({ title, fields }) => {
  return (
    <div className="prop-section">
      <h4>{title}</h4>
      {Object.entries(fields).map(([key, val]) => (
        <label key={key}>
          <span>{key}</span>
          <input type="text" defaultValue={val} data-prop={key} />
        </label>
      ))}
    </div>
  );
};
