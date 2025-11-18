import React, { useEffect, useMemo, useState } from "react";
import { useProjectContext } from "../../core/project-context";
import { fetchProjectModels } from "../../core/projects-api";

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

export function ProfilePicker() {
  const { projectPath, launcherProfile, setLauncherProfile } =
    useProjectContext();
  const [options, setOptions] = useState<ProfileOption[]>(() => [
    ...DEFAULT_PROFILES,
    { label: "Edit Profiles…", value: EDIT_VALUE },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!projectPath) {
        setOptions([
          ...DEFAULT_PROFILES,
          { label: "Edit Profiles…", value: EDIT_VALUE },
        ]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const models = await fetchProjectModels(projectPath);
        if (cancelled) return;

        const modelOptions: ProfileOption[] = models.flatMap((modelPath) => {
          const basename = modelPath.split("/").pop() ?? modelPath;
          const base = basename.replace(/\..*$/, "");
          return [
            { label: `${base} - Local`, value: `local:${modelPath}` },
            { label: `${base} - Native`, value: `native:${modelPath}` },
          ];
        });

        setOptions([
          ...DEFAULT_PROFILES,
          ...modelOptions,
          { label: "Edit Profiles…", value: EDIT_VALUE },
        ]);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load profiles"
          );
          setOptions([
            ...DEFAULT_PROFILES,
            { label: "Edit Profiles…", value: EDIT_VALUE },
          ]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

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
      className="launcher-combo"
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
