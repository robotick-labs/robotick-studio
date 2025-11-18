// src/js/pages/project/project.tsx

import React, { useEffect, useState } from "react";
import {
  useProjectContext,
  fetchProjectSettingsData,
} from "../../core/launcher";
import styles from "./styles/ProjectPage.module.css";

import { StringField } from "./components/StringField";
import { StringArrayField } from "./components/StringArrayField";
import { ObjectArrayField } from "./components/ObjectArrayField";

interface SchemaType {
  properties: Record<string, any>;
}

export default function ProjectPage() {
  const [schema, setSchema] = useState<SchemaType | null>(null);
  const [config, setConfig] = useState<Record<string, any>>({});
  const { projectPath } = useProjectContext();

  useEffect(() => {
    async function load() {
      if (!projectPath) {
        setSchema(null);
        setConfig({});
        return;
      }

      const baseUrl = new URL(
        import.meta.env.BASE_URL ?? "/",
        window.location.origin
      );
      const schemaUrl = new URL(
        "static/schemas/project-config.schema.json",
        baseUrl
      );

      const [schemaResp, cfg] = await Promise.all([
        fetch(schemaUrl).then((r) => r.json()),
        fetchProjectSettingsData<Record<string, any>>(projectPath).catch(
          () => ({} as Record<string, any>)
        ),
      ]);

      setSchema(schemaResp);
      setConfig(cfg);
    }

    load();
  }, [projectPath]);

  if (!projectPath) {
    return (
      <div className={styles.projectContainer}>Select a project to view.</div>
    );
  }

  if (!schema) return <div>Loading…</div>;

  function updateField(key: string, value: any) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    console.log("Prepared for saving:", config);
    alert("Would save:\n\n" + JSON.stringify(config, null, 2));
  }

  return (
    <div className={styles.projectContainer}>
      <div className={styles.saveButtonWrapper}>
        <button className={styles.saveButton} onClick={save}>
          💾 Save
        </button>
      </div>

      <div className={styles.projectTable}>
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
