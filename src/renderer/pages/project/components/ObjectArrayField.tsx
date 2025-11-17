// src/js/pages/project/components/ObjectArrayField.tsx
import React from "react";

interface Props {
  field: string;
  label: string;
  tooltip: string;
  values: Record<string, any>[];
  properties: Record<string, any>;
  onChange: (field: string, value: Record<string, any>[]) => void;
}

export function ObjectArrayField({
  field,
  label,
  tooltip,
  values,
  properties,
  onChange,
}: Props) {
  function updateItem(idx: number, key: string, val: string) {
    const newArr = [...values];
    newArr[idx] = { ...newArr[idx], [key]: val };
    onChange(field, newArr);
  }

  function add() {
    const empty = Object.fromEntries(
      Object.keys(properties).map((k) => [k, ""])
    );
    onChange(field, [...values, empty]);
  }

  function remove(idx: number) {
    onChange(
      field,
      values.filter((_, i) => i !== idx)
    );
  }

  return (
    <div className="project-table-row">
      <div className="project-key" title={tooltip}>
        {label}
      </div>

      <div className="project-value">
        {values.map((obj, idx) => (
          <div className="object-item-wrapper" key={idx}>
            {Object.entries(properties).map(([propKey, propDef]) => (
              <label
                key={propKey}
                title={propDef.description || ""}
                style={{ display: "block", marginBottom: 4 }}
              >
                {formatLabel(propKey)}
                <input
                  type="text"
                  value={obj[propKey] ?? ""}
                  style={{ width: "100%", marginTop: 2 }}
                  onChange={(e) => updateItem(idx, propKey, e.target.value)}
                />
              </label>
            ))}

            <button className="btn-remove" onClick={() => remove(idx)}>
              ×
            </button>
          </div>
        ))}

        <button className="btn-add-item" onClick={add}>
          + Add Group
        </button>
      </div>
    </div>
  );
}

function formatLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
