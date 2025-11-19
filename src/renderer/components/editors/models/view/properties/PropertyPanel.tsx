import React from "react";
import { DocumentStore } from "../../document/documentStore";
import { useSelection } from "../../document/editorSelectionStore";
import styles from "../../styles/ModelsPage.module.css";

type PropertyPanelProps = { store: DocumentStore };

export const PropertyPanel: React.FC<PropertyPanelProps> = ({ store }) => {
  const selectedId = useSelection();
  let workload: any = null;
  let workloadType: string | undefined;

  if (selectedId) {
    const [base, wname] = selectedId.split(":", 2);
    if (base && wname) {
      for (const [modelId, model] of store.entries()) {
        const modelBase = modelId
          .split("/")
          .pop()
          ?.replace(/\.model\.yaml$/, "");
        if (modelBase === base) {
          workload = model.workloads.find((w: any) => w.name === wname) || null;
          if (workload) workloadType = workload.type;
          break;
        }
      }
    }
  }

  if (!workload) {
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
        <span style={{ fontWeight: "normal" }}>| {workloadType}</span>
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
    <div className={styles.propSection}>
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
