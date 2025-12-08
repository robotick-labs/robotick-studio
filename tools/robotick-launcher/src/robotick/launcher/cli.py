# robotick/launcher/cli.py

from typing import Optional

import typer
from pathlib import Path

# Import all actions
from robotick.launcher.actions.launch import (
    clean,
    install_deps,
    generate,
    build,
    deploy,
    run,
    run_profile,
)
from robotick.launcher.actions.query import list
from robotick.launcher.listen.listener import run_server


def create_app() -> typer.Typer:
    app = typer.Typer(help="Robotick Launcher CLI")

    # Subcommand group for cleaning tools
    app.add_typer(clean.clean_app, name="clean")

    @app.command("install-deps")
    def install_deps_cmd(
        project: str = typer.Argument(..., help="Project name (e.g. 'my_robot')"),
        base_dir: Path = typer.Option(
            Path.cwd(), help="Directory containing <project>.project.yaml"
        ),
        workspace_dir: Optional[Path] = typer.Option(
            None, help="Workspace root containing the .launcher folder"
        ),
        dry_run: bool = typer.Option(False, help="Preview dependency install"),
        stub_install: bool = typer.Option(
            False, help="Skip pip installs (useful for CI smoke tests)"
        ),
        model: Optional[str] = typer.Option(
            None, help="Model name to install deps for (default: all models)"
        ),
        target: str = typer.Option(
            "linux", help="Target name to resolve dependencies for"
        ),
    ):
        base_dir = base_dir.resolve()
        workspace_dir = workspace_dir.resolve() if workspace_dir else None
        install_deps.install_deps_command(
            project=project,
            base_dir=base_dir,
            workspace_dir=workspace_dir,
            dry_run=dry_run,
            stub_install=stub_install,
            model=model,
            target=target,
        )

    @app.command("listen")
    def listen_cmd(
        port: int = typer.Option(-1),
    ):
        run_server(port)

    @app.command("generate")
    def generate_cmd(
        project: str = typer.Argument(..., help="Project name (e.g. 'my_robot')"),
        model: str = typer.Argument(..., help="Model name (e.g. 'my_robot_brain')"),
        target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
        base_dir: Path = typer.Option(
            Path.cwd(), help="Base directory to create .launcher folder under"
        ),
        workspace_dir: Optional[Path] = typer.Option(
            None, help="Workspace root containing the .launcher folder"
        ),
        dry_run: bool = typer.Option(
            False, "--dry-run", help="Show what would be created without creating it"
        ),
        no_pre: bool = typer.Option(False, help="Do not run prerequisite stages"),
        force: bool = typer.Option(
            False, help="Force execution regardless of staleness"
        ),
        verbose: bool = typer.Option(False, help="Verbose logging"),
        stub_install: bool = typer.Option(
            False,
            help="Only create target-folder for each installed dependency, not full install",
        ),
        skip_install_deps: bool = typer.Option(
            False, help="Assume install-deps already ran and skip it during generate"
        ),
    ) -> None:
        base_dir = base_dir.resolve()
        workspace_dir = workspace_dir.resolve() if workspace_dir else None

        if not dry_run:
            generate.generate(
                project,
                model,
                target,
                base_dir,
                dry_run,
                bool(stub_install),
                workspace_dir,
                skip_install_deps=skip_install_deps,
            )

    @app.command("build")
    def build_cmd(
        project: str = typer.Argument(...),
        model: str = typer.Argument(...),
        target: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
        workspace_dir: Optional[Path] = typer.Option(
            None, help="Workspace root containing the .launcher folder"
        ),
        dry_run: bool = typer.Option(False),
        no_pre: bool = typer.Option(False),
        force: bool = typer.Option(False),
        verbose: bool = typer.Option(False),
        skip_install_deps: bool = typer.Option(
            False, help="Assume install-deps already ran and skip it during generate"
        ),
    ):
        base_dir = base_dir.resolve()
        workspace_dir = workspace_dir.resolve() if workspace_dir else None
        if not no_pre:
            generate_cmd(
                project,
                model,
                target,
                base_dir,
                workspace_dir,
                dry_run,
                no_pre,
                force=force,
                verbose=verbose,
                stub_install=False,
                skip_install_deps=skip_install_deps,
            )

        if not dry_run:
            build.build(project, model, target, base_dir, dry_run)

    @app.command("deploy")
    def deploy_cmd(
        project: str = typer.Argument(...),
        model: str = typer.Argument(...),
        target: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
        workspace_dir: Optional[Path] = typer.Option(
            None, help="Workspace root containing the .launcher folder"
        ),
        dry_run: bool = typer.Option(False),
        no_pre: bool = typer.Option(False),
        force: bool = typer.Option(False),
        verbose: bool = typer.Option(False),
        skip_install_deps: bool = typer.Option(
            False, help="Assume install-deps already ran and skip it during generate"
        ),
    ):
        base_dir = base_dir.resolve()
        workspace_dir = workspace_dir.resolve() if workspace_dir else None
        if not no_pre:
            build_cmd(
                project,
                model,
                target,
                base_dir,
                workspace_dir,
                dry_run,
                no_pre,
                force=force,
                verbose=verbose,
                skip_install_deps=skip_install_deps,
            )

        if not dry_run:
            deploy.deploy(project, model, target, base_dir)

    @app.command("run")
    def run_cmd(
        project: str = typer.Argument(...),
        model: str = typer.Argument(...),
        target: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
        workspace_dir: Optional[Path] = typer.Option(
            None, help="Workspace root containing the .launcher folder"
        ),
        dry_run: bool = typer.Option(False),
        no_pre: bool = typer.Option(False),
        force: bool = typer.Option(False),
        verbose: bool = typer.Option(False),
        skip_install_deps: bool = typer.Option(
            False, help="Assume install-deps already ran and skip it during generate"
        ),
    ):
        base_dir = base_dir.resolve()
        workspace_dir = workspace_dir.resolve() if workspace_dir else None
        if not no_pre:
            deploy_cmd(
                project,
                model,
                target,
                base_dir,
                workspace_dir,
                dry_run,
                no_pre,
                force=force,
                verbose=verbose,
                skip_install_deps=skip_install_deps,
            )

        if not dry_run:
            run.run(project, model, target, base_dir, workspace_dir)

    @app.command("run-profile")
    def run_profile_cmd(
        project: str = typer.Argument(...),
        profile: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
    ):
        run_profile.run_profile(project, profile, base_dir)

    @app.command("build-profile")
    def build_profile_cmd(
        project: str = typer.Argument(...),
        profile: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
    ):
        run_profile.run_profile(
            project, profile, base_dir, run_after_build=False
        )

    # Query commands (no flags needed)
    app.command(name="list-projects")(list.list_projects_for_cli)
    app.command(name="list-project-models")(list.list_project_models_for_cli)

    return app


def main():
    create_app()()


if __name__ == "__main__":
    main()
