// src/js/pages/project/components/StringArrayField.tsx
import React from "react";

interface Props {
  field: string;
  label: string;
  tooltip: string;
  values: string[];
  onChange: (field: string, value: string[]) => void;
}

export function StringArrayField({
  field,
  label,
  tooltip,
  values,
  onChange,
}: Props) {
  function update(index: number, val: string) {
    const arr = [...values];
    arr[index] = val;
    onChange(field, arr);
  }

  function add() {
    onChange(field, [...values, ""]);
  }

  function remove(index: number) {
    onChange(
      field,
      values.filter((_, i) => i !== index)
    );
  }

  return (
    <div className="project-table-row">
      <div className="project-key" title={tooltip}>
        {label}
      </div>

      <div className="project-value">
        {values.map((v, i) => (
          <div className="array-input-wrapper" key={i}>
            <input
              type="text"
              value={v}
              title={tooltip}
              onChange={(e) => update(i, e.target.value)}
            />
            <button className="btn-remove" onClick={() => remove(i)}>
              ×
            </button>
          </div>
        ))}

        <button className="btn-add-item" onClick={add}>
          + Add Item
        </button>
      </div>
    </div>
  );
}
