import os
import sys
from pathlib import Path


def get_project_root():
    return Path(__file__).resolve().parent.parent


def get_config_path():
    env_path = os.environ.get("FT_ENGINE_CONFIG_PATH")
    if env_path:
        return env_path

    if getattr(sys, "frozen", False):
        executable_dir = Path(sys.executable).resolve().parent
        candidates = [
            executable_dir / "config.yaml",
            executable_dir.parent / "config.yaml",
        ]
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
        return str(candidates[0])

    return str(get_project_root() / "config.yaml")


def get_data_root():
    env_path = os.environ.get("FT_ENGINE_DATA_ROOT")
    if env_path:
        os.makedirs(env_path, exist_ok=True)
        return env_path

    if getattr(sys, "frozen", False):
        executable_dir = Path(sys.executable).resolve().parent
        return str(executable_dir)

    return str(get_project_root())
