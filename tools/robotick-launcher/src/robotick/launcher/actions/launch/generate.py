from pathlib import Path
from rich import print
import shutil
import typer
import traceback
import yaml

from robotick.launcher.utils import get_launcher_paths, copy_extras_for_target
from robotick.launcher.actions.launch import (
    generate_main_cpp,
    generate_model_cpp,
    generate_cmake,
    generate_workloads_registry,
    generate_do_install_deps
)

class DotDict(dict):
    """A dictionary that supports dot-access like an object."""
    def __getattr__(self, name):
        value = self.get(name)
        if isinstance(value, dict):
            return DotDict(value)
        if isinstance(value, list):
            return [DotDict(v) if isinstance(v, dict) else v for v in value]
        return value

    def __setattr__(self, name, value):
        self[name] = value

    def __delattr__(self, name):
        if name in self:
            del self[name]

class Config:
    def __init__(self, project: str, model: str, target: str, base_dir: Path, dry_run: bool, stub_install: bool):
        self.project_name = project
        self.model_name = model
        self.model_name_safe = model.replace("-", "_")
        self.target = target
        self.base_dir = base_dir
        self.dry_run = dry_run
        self.stub_install = stub_install

        # Load and parse YAML data
        self.project = self._load_yaml(base_dir / f"{project}.project.yaml")
        self.model = self._load_yaml(self._find_model_yaml(base_dir, model))

        # Launcher path
        self.launcher_dir, _, _ = get_launcher_paths(project, model, target, base_dir)


    def _find_model_yaml(self, base_dir: Path, model: str) -> Path:
        model_file_name = f"{model}.model.yaml"
        matches = list(base_dir.rglob(model_file_name))
        if not matches:
            raise FileNotFoundError(f"Could not find model file '{model_file_name}' under {base_dir}")
        if len(matches) > 1:
            raise RuntimeError(f"Multiple '{model_file_name}' model files found: {matches}")
        return matches[0]
    

    def _load_yaml(self, path: Path) -> DotDict:
        if not path.exists():
            print(f"[red]❌ Missing YAML file:[/] {path}")
            raise typer.Exit(1)

        try:
            content = yaml.safe_load(path.read_text()) or {}
            return DotDict(content)
        except Exception as e:
            print(f"[red]❌ Failed to parse YAML file:[/] {path}")
            print(f"[red]Reason:[/] {e}")
            raise typer.Exit(1)


def copy_extras_if_exists(templates_dir: Path, target_dir: Path, target: str):
    """
    Copy all files (recursively) from templates/extras_<target>/ into target_dir.
    Existing files are overwritten. Skips if extras folder doesn't exist.
    """
    extras_dir = templates_dir / f"extras_{target}"
    if not extras_dir.exists() or not extras_dir.is_dir():
        print(f"ℹ️ No extras for target '{target}' (looked in {extras_dir})")
        return

    print(f"📦 Copying extras for '{target}' from {extras_dir} → {target_dir}")
    for src in extras_dir.rglob("*"):
        if src.is_file():
            rel_path = src.relative_to(extras_dir)
            dest_path = target_dir / rel_path
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest_path)  # preserve metadata
            print(f"  ✅ {rel_path}")

def generate(
    project: str = typer.Argument(..., help="Project name (e.g. 'my_robot')"),
    model: str = typer.Argument(..., help="Model name (e.g. 'my_robot_brain')"),
    target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
    base_dir: Path = typer.Option(Path.cwd(), help="Base directory to create .launcher folder under"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Show what would be created without creating it"),
    stub_install: bool = typer.Option(False, "--stub-install", help="Only create target-folder for each installed dependency, not full install")
):
    """
    Generate the .launcher folder structure and files for the given project/model/target.
    """

    try:
        config = Config(project, model, target, base_dir, dry_run, stub_install)

        print("============================================================================================")
        print(f"[bold green]📦 Generating {project}-{model}-{target}[/] (dry_run={dry_run}, stub_install={config.stub_install})")

        # placeholder code for per-target overrides (needs to move to a yaml ideally)
        if target == "esp32":
            config.subdir_main_cpp = "main"
            config.subdir_model_cpp = "main"
            config.subdir_registry = "main"
            config.should_generate_workload_deps = False
            config.should_generate_component_cmakelists = True
            config.subdir_component_cmakelists = "main"
        else:
            config.should_generate_workload_deps = True
            config.should_generate_component_cmakelists = False

        # Folder creation
        config.launcher_dir.mkdir(parents=True, exist_ok=True)
        print(f"[green]📂 Launcher folder:[/] {config.launcher_dir}")

        # File generation
        copy_extras_for_target(config)
        generate_main_cpp.generate_main_cpp(config)
        generate_model_cpp.generate_model_cpp(config)
        generate_workloads_registry.generate_workloads_registry(config)
        generate_cmake.generate_project_cmakelists(config)
        generate_cmake.generate_component_cmakelists(config)

        generate_do_install_deps.generate_do_install_deps(config)

        print(f"[bold green]✅ Generating complete!")

    except Exception as e:
        print(f"[bold red]❌ Generation failed with error:[/] {type(e).__name__}: {e}")
        traceback.print_exc()
        raise typer.Exit(code=1)
