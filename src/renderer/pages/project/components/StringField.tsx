// src/js/pages/project/components/StringField.tsx
import React from "react";

interface Props {
  field: string;
  label: string;
  tooltip: string;
  value: string;
  onChange: (field: string, value: string) => void;
}

export function StringField({ field, label, tooltip, value, onChange }: Props) {
  return (
    <div className="project-table-row">
      <div className="project-key" title={tooltip}>
        {label}
      </div>
      <div className="project-value">
        <input
          type="text"
          value={value}
          title={tooltip}
          onChange={(e) => onChange(field, e.target.value)}
        />
      </div>
    </div>
  );
}
