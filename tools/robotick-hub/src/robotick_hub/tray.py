from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
from typing import Callable

from PyQt5.QtCore import QTimer
from PyQt5.QtGui import QColor, QIcon, QPainter, QPixmap
from PyQt5.QtWidgets import QAction, QApplication, QMenu, QMessageBox, QSystemTrayIcon

from robotick_hub.app import get_endpoint, get_workspace_root


def has_desktop_session() -> bool:
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def should_use_tray() -> bool:
    if os.environ.get("ROBOTICK_HUB_FORCE_HEADLESS") == "1":
        return False
    if os.environ.get("ROBOTICK_HUB_FORCE_TRAY") == "1":
        return True
    return has_desktop_session()


def get_bundled_icon_path() -> Path:
    return Path(__file__).resolve().parent / "assets" / "robotick-icon.png"


def build_fallback_icon() -> QIcon:
    pixmap = QPixmap(64, 64)
    pixmap.fill(QColor("#0f172a"))
    painter = QPainter(pixmap)
    painter.setBrush(QColor("#f59e0b"))
    painter.setPen(QColor("#f59e0b"))
    painter.drawEllipse(12, 12, 40, 40)
    painter.end()
    return QIcon(pixmap)


def load_tray_icon() -> QIcon:
    icon_path = get_bundled_icon_path()
    if icon_path.exists() and icon_path.stat().st_size > 0:
        icon = QIcon(str(icon_path))
        if not icon.isNull():
            return icon
    return build_fallback_icon()


def start_tray(stop_hub: Callable[[], None]) -> int:
    app = QApplication.instance() or QApplication(sys.argv[:1])
    app.setQuitOnLastWindowClosed(False)
    if not QSystemTrayIcon.isSystemTrayAvailable():
        raise RuntimeError("No system tray is available in this desktop session.")

    workspace_root = Path(get_workspace_root())
    endpoint = get_endpoint()
    icon = load_tray_icon()

    tray = QSystemTrayIcon(icon, app)
    tray.setToolTip(f"Robotick Hub\n{workspace_root.name}\n{endpoint}")

    menu = QMenu()

    status_action = QAction("Hub Status", menu)

    def show_status() -> None:
        QMessageBox.information(
            None,
            "Robotick Hub",
            f"Robotick Hub is running.\n\nWorkspace: {workspace_root}\nEndpoint: {endpoint}",
        )

    status_action.triggered.connect(show_status)
    menu.addAction(status_action)

    open_studio_action = QAction("Open Studio", menu)

    def open_studio() -> None:
        robotick_cmd = workspace_root / "tools" / "robotick"
        subprocess.Popen(
            [str(robotick_cmd), "studio", "open"],
            cwd=workspace_root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

    open_studio_action.triggered.connect(open_studio)
    menu.addAction(open_studio_action)
    menu.addSeparator()

    quit_action = QAction("Stop Robotick Hub", menu)

    def stop_and_quit() -> None:
        tray.hide()
        stop_hub()
        app.quit()

    quit_action.triggered.connect(stop_and_quit)
    menu.addAction(quit_action)

    tray.setContextMenu(menu)
    tray.show()
    tray.showMessage("Robotick Hub", "Robotick Hub is running.", QSystemTrayIcon.Information, 2500)

    keep_alive = QTimer()
    keep_alive.timeout.connect(lambda: None)
    keep_alive.start(1000)

    return app.exec_()
