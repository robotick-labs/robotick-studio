from pathlib import Path
from rich import print
import typer

from robotick.launcher.actions.launch.target_plan import resolve_target_plan
from robotick.launcher.utils import get_launcher_paths

def deploy(
    project: str = typer.Argument(..., help="Project name (e.g. 'barr_e')"),
    model: str = typer.Argument(..., help="Model name (e.g. 'barr_e_brain')"),
    target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
    base_dir: Path = typer.Option(Path.cwd(), help="Base directory containing .launcher"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print commands without executing them"),
):
    _, _, binary_path = get_launcher_paths(project, model, target, base_dir)
    plan = resolve_target_plan(project, model, target, base_dir)

    print("============================================================================================")
    print(f"[bold green]📤 Deploying {binary_path}[/]")
    print(f"[cyan]🧭 Deploy strategy:[/] {plan.deploy.strategy}")
    plan.deploy.print_summary()
    if plan.deploy.deploy_handler is not None:
        plan.deploy.deploy_handler(dry_run)
        if dry_run:
            print("[yellow]⚠️ Dry run only — commands not executed.[/]")
            return
        print(f"[bold green]✅ Deploying complete ({plan.deploy.strategy}).[/]")
        return

    if not binary_path.exists():
        print(f"[bold red]❌ Binary not found: {binary_path}[/]")
        raise typer.Exit(code=1)

    if target == "linux" or target == "esp32":
        print(f"[bold green]✅ Deploying complete ({target}).[/]")
    else:
        print(f"[bold red]❌ Target '{target}' not yet supported for deploy.[/]")
        raise typer.Exit(code=1)
