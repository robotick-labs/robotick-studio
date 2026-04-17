# robotick/launcher/cli.py

from typing import Optional

import typer
from pathlib import Path

# Import all actions
from robotick.launcher.actions.launch import (
    clean,
    project_workspace_hydration,
    prepare_project_workspace,
    prepare_project_docker,
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

    @app.command("prepare-project-workspace")
    def prepare_project_workspace_cmd(
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
        prepare_project_workspace.prepare_project_workspace_command(
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
        skip_prepare_project_workspace: bool = typer.Option(
            False,
            help="Assume prepare-project-workspace already ran and skip it during generate",
        ),
        skip_prepare_project_docker: bool = typer.Option(
            False,
            help="Assume prepare-project-docker already ran and skip it during generate",
        ),
    ) -> None:
        base_dir = base_dir.resolve()
        workspace_dir = workspace_dir.resolve() if workspace_dir else None

        generate.generate(
            project,
            model,
            target,
            base_dir,
            dry_run,
            bool(stub_install),
            workspace_dir,
            skip_prepare_project_workspace=skip_prepare_project_workspace,
            skip_prepare_project_docker=skip_prepare_project_docker,
        )

    @app.command("prepare-project-docker")
    def prepare_project_docker_cmd(
        project: str = typer.Argument(..., help="Project name (e.g. 'my_robot')"),
        target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
        base_dir: Path = typer.Option(
            Path.cwd(), help="Directory containing <project>.project.yaml"
        ),
        dry_run: bool = typer.Option(
            False, "--dry-run", help="Show what would be created without creating it"
        ),
        stub_install: bool = typer.Option(
            False,
            help="Only create target-folder for each installed dependency, not full install",
        ),
        model: Optional[str] = typer.Option(
            None, help="Limit preparation to one model instead of all models in scope"
        ),
    ) -> None:
        prepare_project_docker.prepare_project_docker(
            project=project,
            base_dir=base_dir.resolve(),
            target=target,
            model=model,
            dry_run=dry_run,
            stub_install=stub_install,
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
        skip_prepare_project_workspace: bool = typer.Option(
            False,
            help="Assume prepare-project-workspace already ran and skip it during generate",
        ),
        skip_prepare_project_docker: bool = typer.Option(
            False,
            help="Assume prepare-project-docker already ran and skip it during generate",
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
                skip_prepare_project_workspace=skip_prepare_project_workspace,
                skip_prepare_project_docker=skip_prepare_project_docker,
            )

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
        skip_prepare_project_workspace: bool = typer.Option(
            False,
            help="Assume prepare-project-workspace already ran and skip it during generate",
        ),
        skip_prepare_project_docker: bool = typer.Option(
            False,
            help="Assume prepare-project-docker already ran and skip it during generate",
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
                skip_prepare_project_workspace=skip_prepare_project_workspace,
                skip_prepare_project_docker=skip_prepare_project_docker,
            )

        deploy.deploy(project, model, target, base_dir, dry_run)

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
        skip_prepare_project_workspace: bool = typer.Option(
            False,
            help="Assume prepare-project-workspace already ran and skip it during generate",
        ),
        skip_prepare_project_docker: bool = typer.Option(
            False,
            help="Assume prepare-project-docker already ran and skip it during generate",
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
                skip_prepare_project_workspace=skip_prepare_project_workspace,
                skip_prepare_project_docker=skip_prepare_project_docker,
            )

        run.run(project, model, target, base_dir, workspace_dir, dry_run)

    @app.command("run-profile")
    def run_profile_cmd(
        project: str = typer.Argument(...),
        profile: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
    ):
        result = run_profile.run_profile(project, profile, base_dir)
        status = result.get("status") if isinstance(result, dict) else None
        if status not in {"ok", "build_completed"}:
            raise typer.Exit(code=1)

    @app.command("build-profile")
    def build_profile_cmd(
        project: str = typer.Argument(...),
        profile: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
    ):
        result = run_profile.run_profile(
            project, profile, base_dir, run_after_build=False
        )
        status = result.get("status") if isinstance(result, dict) else None
        if status != "build_completed":
            raise typer.Exit(code=1)

    # Query commands (no flags needed)
    app.command(name="list-projects")(list.list_projects_for_cli)
    app.command(name="list-project-models")(list.list_project_models_for_cli)

    return app


def main():
    create_app()()


if __name__ == "__main__":
    main()
