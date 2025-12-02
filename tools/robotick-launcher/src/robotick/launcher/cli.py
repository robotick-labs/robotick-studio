# robotick/launcher/cli.py

import typer
from pathlib import Path

# Import all actions
from robotick.launcher.actions.launch import (
    clean,
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
    ) -> None:
        if not dry_run:
            generate.generate(
                project, model, target, base_dir, dry_run, bool(stub_install)
            )

    @app.command("build")
    def build_cmd(
        project: str = typer.Argument(...),
        model: str = typer.Argument(...),
        target: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
        dry_run: bool = typer.Option(False),
        no_pre: bool = typer.Option(False),
        force: bool = typer.Option(False),
        verbose: bool = typer.Option(False),
    ):
        if not no_pre:
            generate_cmd(
                project,
                model,
                target,
                base_dir,
                dry_run,
                no_pre,
                force=force,
                verbose=verbose,
                stub_install=False,
            )

        if not dry_run:
            build.build(project, model, target, base_dir, dry_run)

    @app.command("deploy")
    def deploy_cmd(
        project: str = typer.Argument(...),
        model: str = typer.Argument(...),
        target: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
        dry_run: bool = typer.Option(False),
        no_pre: bool = typer.Option(False),
        force: bool = typer.Option(False),
        verbose: bool = typer.Option(False),
    ):
        if not no_pre:
            build_cmd(
                project,
                model,
                target,
                base_dir,
                dry_run,
                no_pre,
                force=force,
                verbose=verbose,
            )

        if not dry_run:
            deploy.deploy(project, model, target, base_dir)

    @app.command("run")
    def run_cmd(
        project: str = typer.Argument(...),
        model: str = typer.Argument(...),
        target: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
        dry_run: bool = typer.Option(False),
        no_pre: bool = typer.Option(False),
        force: bool = typer.Option(False),
        verbose: bool = typer.Option(False),
    ):
        if not no_pre:
            deploy_cmd(
                project,
                model,
                target,
                base_dir,
                dry_run,
                no_pre,
                force=force,
                verbose=verbose,
            )

        if not dry_run:
            run.run(project, model, target, base_dir)

    @app.command("run-profile")
    def run_profile_cmd(
        project: str = typer.Argument(...),
        profile: str = typer.Argument(...),
        base_dir: Path = typer.Option(Path.cwd()),
    ):
        run_profile.run_profile(project, profile, base_dir)

    # Query commands (no flags needed)
    app.command(name="list-projects")(list.list_projects_for_cli)
    app.command(name="list-project-models")(list.list_project_models_for_cli)

    return app


def main():
    create_app()()


if __name__ == "__main__":
    main()
