// src/js/components/editors/project/components/ObjectArrayField.tsx
import React from "react";
import styles from "../styles/ProjectPage.module.css";

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
    <div className={styles.row}>
      <div className={styles.key} title={tooltip}>
        {label}
      </div>

      <div className={styles.value}>
        {values.map((obj, idx) => (
          <div className={styles.objectItemWrapper} key={idx}>
            {Object.entries(properties).map(([propKey, propDef]) => (
              <label
                key={propKey}
                title={propDef.description || ""}
                className={styles.objectLabel}
              >
                {formatLabel(propKey)}
                <input
                  type="text"
                  value={obj[propKey] ?? ""}
                  className={styles.textInput}
                  onChange={(e) => updateItem(idx, propKey, e.target.value)}
                />
              </label>
            ))}

            <button
              className={styles.removeButton}
              type="button"
              onClick={() => remove(idx)}
            >
              ×
            </button>
          </div>
        ))}

        <button className={styles.addItemButton} type="button" onClick={add}>
          + Add Group
        </button>
      </div>
    </div>
  );
}

function formatLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
