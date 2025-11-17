// src/js/pages/project/project.tsx

import React, { useEffect, useState } from "react";
import currentProject from "../../core/current-project.js";

import { StringField } from "./components/StringField";
import { StringArrayField } from "./components/StringArrayField";
import { ObjectArrayField } from "./components/ObjectArrayField";

interface SchemaType {
  properties: Record<string, any>;
}

export default function ProjectPage() {
  const [schema, setSchema] = useState<SchemaType | null>(null);
  const [config, setConfig] = useState<Record<string, any>>({});

  useEffect(() => {
    async function load() {
      // Load schema
      const schema = await fetch(
        "./static/schemas/project-config.schema.json"
      ).then((r) => r.json());

      // Load config
      const projectPath = currentProject.getProjectPath();
      const url = `http://localhost:7081/query/get-project-settings?project_path=${encodeURIComponent(
        projectPath
      )}`;

      const cfg = await fetch(url)
        .then((r) => r.json())
        .catch(() => ({}));

      setSchema(schema);
      setConfig(cfg);
    }

    load();
  }, []);

  if (!schema) return <div>Loading…</div>;

  function updateField(key: string, value: any) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    console.log("Prepared for saving:", config);
    alert("Would save:\n\n" + JSON.stringify(config, null, 2));
  }

  return (
    <div className="project-container">
      <div className="save-button-wrapper">
        <button className="btn-primary btn-save-project" onClick={save}>
          💾 Save
        </button>
      </div>

      <div className="project-table">
        {Object.entries(schema.properties).map(([key, def]) => {
          const label = formatLabel(key);
          const tooltip = def.description;
          const value = config[key] ?? (def.type === "array" ? [] : "");

          if (def.type === "string") {
            return (
              <StringField
                key={key}
                field={key}
                value={value}
                label={label}
                tooltip={tooltip}
                onChange={updateField}
              />
            );
          }

          if (def.type === "array" && def.items.type === "string") {
            return (
              <StringArrayField
                key={key}
                field={key}
                values={value}
                label={label}
                tooltip={tooltip}
                onChange={updateField}
              />
            );
          }

          if (def.type === "array" && def.items.type === "object") {
            return (
              <ObjectArrayField
                key={key}
                field={key}
                values={value}
                properties={def.items.properties}
                label={label}
                tooltip={tooltip}
                onChange={updateField}
              />
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

// Utility — same as legacy version
function formatLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
