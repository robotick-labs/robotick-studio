import React, { useMemo } from "react";
import { Project } from "../../data-sources/launcher";

const useProjectContext = Project.Context.use;
const useProjectModels = Project.Hooks.useModels;
import styles from "./styles/ProfilePicker.module.css";

type ProfileOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

const DEFAULT_PROFILES: ProfileOption[] = [
  { label: "All - Local", value: "local:ALL" },
  { label: "All - Native", value: "native:ALL" },
];

const EDIT_VALUE = "__edit__";
const pathSeparatorRegex = /[/\\]/;

function getBasename(filePath: string) {
  const parts = filePath.split(pathSeparatorRegex);
  return parts[parts.length - 1] || filePath;
}

export function ProfilePicker() {
  const { projectPath, launcherProfile, setLauncherProfile } =
    useProjectContext();
  const { models, loading, error } = useProjectModels(projectPath, 5000);

  const options = useMemo<ProfileOption[]>(() => {
    const modelOptions: ProfileOption[] = projectPath
      ? models.flatMap((modelPath) => {
          const basename = getBasename(modelPath);
          const base = basename.replace(/\..*$/, "");
          return [
            { label: `${base} - Local`, value: `local:${modelPath}` },
            { label: `${base} - Native`, value: `native:${modelPath}` },
          ];
        })
      : [];
    return [
      ...DEFAULT_PROFILES,
      ...modelOptions,
      { label: "Edit Profiles…", value: EDIT_VALUE },
    ];
  }, [models, projectPath]);

  const mergedOptions = useMemo(() => {
    if (!launcherProfile) return options;
    if (options.some((opt) => opt.value === launcherProfile)) {
      return options;
    }
    return [
      ...options,
      {
        value: launcherProfile,
        label: `Custom (${launcherProfile})`,
        disabled: true,
      },
    ];
  }, [launcherProfile, options]);

  function handleChange(value: string) {
    if (value === EDIT_VALUE) {
      alert("Profile editor not implemented yet.");
      return;
    }
    setLauncherProfile(value);
  }

  return (
    <select
      className={styles.select}
      aria-label="Select launcher profile"
      value={launcherProfile || ""}
      onChange={(event) => handleChange(event.target.value)}
      disabled={!projectPath || loading}
    >
      <option value="" disabled={Boolean(launcherProfile)}>
        {loading ? "Loading profiles..." : "Select a Profile"}
      </option>
      {mergedOptions.map((option) => (
        <option
          key={option.value}
          value={option.value}
          disabled={option.disabled}
        >
          {option.label}
        </option>
      ))}
      {error ? (
        <option value="__error" disabled>
          Failed to load profiles
        </option>
      ) : null}
    </select>
  );
}
