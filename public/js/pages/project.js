import currentProject from "/js/core/current-project.js";

export async function init() {
  const editor = document.getElementById("config-editor");
  const saveBtn = document.getElementById("save-project");

  const schema = await fetch("/schemas/project-config.schema.json").then(
    (res) => res.json()
  );

  const projectPath = currentProject.getProjectPath();
  const configUrl = `http://localhost:7081/query/get-project-settings?project_path=${encodeURIComponent(
    projectPath
  )}`;
  const config = await fetch(configUrl)
    .then((res) => res.json())
    .catch(() => ({}));

  for (const [key, def] of Object.entries(schema.properties)) {
    const value = config[key] ?? (def.type === "array" ? [] : "");
    const label = formatLabel(key);
    const desc = def.description || "";

    if (def.type === "string") {
      renderStringField(editor, key, label, desc, value);
    } else if (def.type === "array") {
      if (def.items.type === "string") {
        renderStringArray(editor, key, label, desc, value);
      } else if (def.items.type === "object") {
        renderArrayOfObjects(
          editor,
          key,
          label,
          desc,
          value,
          def.items.properties
        );
      }
    }
  }

  saveBtn.addEventListener("click", () => {
    const output = {};
    editor.querySelectorAll("[data-field]").forEach((el) => {
      const key = el.dataset.field;

      if (el.dataset.type === "string") {
        output[key] = el.value.trim();
      } else if (el.dataset.type === "array") {
        output[key] = Array.from(el.querySelectorAll("input"))
          .map((i) => i.value.trim())
          .filter((v) => v.length > 0);
      } else if (el.dataset.type === "array-object") {
        output[key] = Array.from(
          el.querySelectorAll(".object-item-wrapper")
        ).map((wrapper) => {
          const entry = {};
          wrapper.querySelectorAll("input").forEach((input) => {
            const subKey = input.dataset.subkey;
            entry[subKey] = input.value.trim();
          });
          return entry;
        });
      }
    });

    console.log("Prepared for saving:", output);
    alert("Would save:\n\n" + JSON.stringify(output, null, 2));
  });
}

// ─────────────────────────────────────────────────────────────
// Field Renderers

function formatLabel(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderStringField(container, key, label, tooltip, value) {
  container.insertAdjacentHTML(
    "beforeend",
    `
    <div class="project-table-row">
      <div class="project-key" title="${tooltip}">${label}</div>
      <div class="project-value">
        <input
          type="text"
          data-field="${key}"
          data-type="string"
          value="${value}"
          title="${tooltip}"
        />
      </div>
    </div>
  `
  );
}

function renderStringArray(container, key, label, tooltip, values) {
  const wrapperId = `wrapper-${key}`;
  const html = `
    <div class="project-table-row">
      <div class="project-key" title="${tooltip}">${label}</div>
      <div class="project-value" data-field="${key}" data-type="array" id="${wrapperId}">
        ${values
          .map(
            (v) =>
              `<div class="array-input-wrapper">
                 <input type="text" value="${v}" title="${tooltip}" />
                 <button class="btn-remove">×</button>
               </div>`
          )
          .join("")}
        <button class="btn-add-item" data-add-button>+ Add Item</button>
      </div>
    </div>
  `;
  container.insertAdjacentHTML("beforeend", html);

  const wrapper = document.getElementById(wrapperId);
  const addButton = wrapper.querySelector("[data-add-button]");
  addButton.addEventListener("click", () => addArrayItem(wrapper, "", tooltip));
  wrapper.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", () => btn.parentElement.remove());
  });
}

function addArrayItem(wrapper, value = "", title = "") {
  const div = document.createElement("div");
  div.className = "array-input-wrapper";
  div.innerHTML = `
    <input type="text" value="${value}" title="${title}" />
    <button class="btn-remove">×</button>
  `;
  div
    .querySelector(".btn-remove")
    .addEventListener("click", () => div.remove());
  wrapper.insertBefore(div, wrapper.querySelector("[data-add-button]"));
}

function renderArrayOfObjects(
  container,
  key,
  label,
  tooltip,
  values,
  propertyDefs
) {
  const wrapperId = `wrapper-${key}`;
  const html = `
    <div class="project-table-row">
      <div class="project-key" title="${tooltip}">${label}</div>
      <div class="project-value" data-field="${key}" data-type="array-object" id="${wrapperId}">
        ${values.map((v) => renderObjectItem(v, propertyDefs)).join("")}
        <button class="btn-add-item" data-add-button>+ Add Group</button>
      </div>
    </div>
  `;
  container.insertAdjacentHTML("beforeend", html);

  const wrapper = document.getElementById(wrapperId);
  const addButton = wrapper.querySelector("[data-add-button]");
  addButton.addEventListener("click", () => {
    const empty = {};
    for (const k of Object.keys(propertyDefs)) empty[k] = "";
    wrapper.insertBefore(createObjectItem(empty, propertyDefs), addButton);
  });

  wrapper.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", () =>
      btn.closest(".object-item-wrapper").remove()
    );
  });
}

function renderObjectItem(obj, propertyDefs) {
  const inputs = Object.entries(propertyDefs)
    .map(([propKey, propDef]) => {
      const val = obj[propKey] ?? "";
      const label = formatLabel(propKey);
      return `
      <label title="${
        propDef.description || ""
      }" style="display: block; margin-bottom: 4px;">
        ${label}
        <input
          type="text"
          data-subkey="${propKey}"
          value="${val}"
          style="width: 100%; margin-top: 2px;"
        />
      </label>
    `;
    })
    .join("");

  return `
    <div class="object-item-wrapper" style="margin-bottom: 10px; border: 1px solid #444; padding: 10px; border-radius: 6px;">
      ${inputs}
      <button class="btn-remove" style="margin-top: 6px;">×</button>
    </div>
  `;
}

function createObjectItem(obj, propertyDefs) {
  const wrapper = document.createElement("div");
  wrapper.className = "object-item-wrapper";
  wrapper.innerHTML = renderObjectItem(obj, propertyDefs);
  wrapper
    .querySelector(".btn-remove")
    .addEventListener("click", () => wrapper.remove());
  return wrapper;
}
