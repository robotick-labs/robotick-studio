from pathlib import Path
from rich import print
from robotick.launcher.utils import render_template, write_text_if_changed

def generate_main_cpp(config):
    """
    Generate the main entrypoint source file using a Jinja2 template. 
    """
    filename = f"{config.model_name_safe}_main.cpp"
    
    subdir = getattr(config, "subdir_main_cpp", None)
    path = config.launcher_dir / subdir / filename if subdir else config.launcher_dir / filename

    context = {
        "model_name": config.model_name,
        "model_name_safe": config.model_name_safe,
        "filename": filename,
        "config": config,
    }

    if config.dry_run:
        print(f"[yellow]📝 Dry run — would create main source file:[/] {path}")
        return

    try:
        # 🔹 Ensure folder exists
        path.parent.mkdir(parents=True, exist_ok=True)
        
        template_file_name = f"template_main_{config.target}.cpp"
        contents = render_template(template_file_name, context)
        write_text_if_changed(path, contents)
    except FileNotFoundError as e:
        print(f"[bold red]❌ Template error:[/] {e}")
    except Exception as e:
        print(f"[bold red]❌ Failed to write file:[/] {path}")
        print(f"[red]Reason:[/] {e}")
