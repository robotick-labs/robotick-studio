from __future__ import annotations

from robotick.launcher.hub_ability import ability


def test_runtime_process_classifier_separates_engine_wrappers_and_runtime() -> None:
    assert (
        ability._classify_runtime_process(
            {"pid": 100, "name": "python", "command": "python -m robotick.launcher.cli run barr-e barr-e-spine"},
            root_pid=100,
            model_id="barr-e-spine",
        )
        == "wrapper"
    )
    assert (
        ability._classify_runtime_process(
            {
                "pid": 101,
                "name": "barr-e-spine",
                "command": "/robots/barr-e/.launcher/barr_e/generated/barr_e_spine/linux/build/barr-e-spine",
            },
            root_pid=100,
            model_id="barr-e-spine",
        )
        == "engine"
    )
    assert (
        ability._classify_runtime_process(
            {
                "pid": 101,
                "name": "barr-e-spine",
                "command": "/robots/barr-e/.launcher/barr_e/generated/barr_e_spine/linux/build/barr-e-spine",
            },
            root_pid=101,
            model_id="barr-e-spine",
        )
        == "engine"
    )
    assert (
        ability._classify_runtime_process(
            {
                "pid": 102,
                "name": "ros2",
                "command": "/usr/bin/python3 /opt/ros/humble/bin/ros2 launch barr_e_mapping barr_e_mapping.launch.py",
            },
            root_pid=100,
            model_id="barr-e-mapping",
        )
        == "wrapper"
    )
    assert (
        ability._classify_runtime_process(
            {
                "pid": 103,
                "name": "rtabmap",
                "command": "/opt/ros/humble/lib/rtabmap_slam/rtabmap --ros-args",
            },
            root_pid=100,
            model_id="barr-e-mapping",
        )
        == "runtime"
    )


def test_runtime_process_display_name_uses_command_basename() -> None:
    assert (
        ability._display_name_from_command(
            "rtk_ros_bridge_",
            "/home/user/ros2_ws/install/barr_e_mapping/lib/barr_e_mapping/rtk_ros_bridge_node --ros-args",
        )
        == "rtk_ros_bridge_node"
    )
    assert (
        ability._display_name_from_command(
            "yolo_detector_n",
            "/usr/bin/python3 /home/user/ros2_ws/install/barr_e_yolo_detector/lib/barr_e_yolo_detector/yolo_detector_node --ros-args",
        )
        == "yolo_detector_node"
    )
    assert (
        ability._display_name_from_command(
            "parameter_bridg",
            "/opt/ros/humble/lib/ros_gz_bridge/parameter_bridge /clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock",
        )
        == "parameter_bridge"
    )


def test_process_tree_metrics_uses_previous_cpu_counters(monkeypatch) -> None:
    samples = [
        {
            "root": {
                "pid": 100,
                "name": "model-worker",
                "ppid": 1,
                "process_group_id": 100,
                "session_id": 100,
                "cpu_ticks": 100,
            },
            "processes": [
                {
                    "pid": 100,
                    "ppid": 1,
                    "name": "model-worker",
                    "cpu_ticks": 100,
                    "memory_bytes": 50,
                    "children": 1,
                },
                {
                    "pid": 101,
                    "ppid": 100,
                    "namespace_pids": [101, 12],
                    "name": "sim-worker",
                    "display_name": "sim-worker-full",
                    "cpu_ticks": 200,
                    "memory_bytes": 75,
                    "children": 0,
                },
            ],
        },
        {
            "root": {
                "pid": 100,
                "name": "model-worker",
                "ppid": 1,
                "process_group_id": 100,
                "session_id": 100,
                "cpu_ticks": 160,
            },
            "processes": [
                {
                    "pid": 100,
                    "ppid": 1,
                    "name": "model-worker",
                    "cpu_ticks": 160,
                    "memory_bytes": 60,
                    "children": 1,
                },
                {
                    "pid": 101,
                    "ppid": 100,
                    "namespace_pids": [101, 12],
                    "name": "sim-worker",
                    "display_name": "sim-worker-full",
                    "cpu_ticks": 290,
                    "memory_bytes": 90,
                    "children": 0,
                },
            ],
        },
    ]

    ability._PROCESS_METRICS_PREVIOUS.clear()
    monkeypatch.setattr(ability, "_PROCESS_METRICS_CLOCK_TICKS", 100)
    monkeypatch.setattr(
        ability,
        "_collect_process_tree_stats",
        lambda _pid, **_kwargs: samples.pop(0),
    )
    sample_times = iter([10.0, 11.0])
    monkeypatch.setattr(ability.time, "monotonic", lambda: next(sample_times))

    first = ability._sample_process_tree_metrics(100)
    assert first is not None
    assert first["cpu_percent"] is None
    assert first["sample_window_ms"] is None
    assert first["memory_bytes"] == 125
    assert first["process_count"] == 2

    second = ability._sample_process_tree_metrics(100)
    assert second is not None
    assert second["sample_window_ms"] == 1000
    assert second["cpu_percent"] == 150.0
    assert second["memory_bytes"] == 150
    assert second["engine_process"] is None
    assert second["top_processes"][0]["pid"] == 101
    assert second["top_processes"][0]["parent_pid"] == 100
    assert second["top_processes"][0]["namespace_pids"] == [101, 12]
    assert second["top_processes"][0]["display_name"] == "sim-worker-full"
    assert second["top_processes"][0]["cpu_percent"] == 90.0
    assert [process["pid"] for process in second["processes"]] == [100, 101]


def test_runtime_projection_includes_metrics_for_live_pid(monkeypatch) -> None:
    monkeypatch.setattr(ability, "_operation_in_flight", lambda _record: None)
    monkeypatch.setattr(
        ability,
        "_probe_runtime_phonebook_record",
        lambda _record: {"healthy": True, "configured": True, "error": None},
    )
    monkeypatch.setattr(ability, "_pid_alive", lambda pid: pid == 123)
    monkeypatch.setattr(
        ability,
        "_sample_process_tree_metrics",
        lambda pid, **_kwargs: {
            "resource_type": "robotick_launcher_runtime_metrics",
            "root_pid": pid,
        },
    )

    projection = ability._runtime_live_projection(
        {
            "id": "runtime-1",
            "project_id": "barr-e",
            "project_path": "/project",
            "model_id": "barr-e-spine",
            "pid": 123,
        }
    )

    assert projection["lifecycle"] == "running"
    assert projection["metrics"] == {
        "resource_type": "robotick_launcher_runtime_metrics",
        "root_pid": 123,
    }


def test_runtime_projection_recovers_live_pid_from_healthy_probe(monkeypatch) -> None:
    monkeypatch.setattr(ability, "_operation_in_flight", lambda _record: None)
    monkeypatch.setattr(
        ability,
        "_probe_runtime_phonebook_record",
        lambda _record: {"healthy": True, "configured": True, "error": None},
    )
    monkeypatch.setattr(ability, "_pid_alive", lambda pid: pid == 456)
    monkeypatch.setattr(
        ability,
        "_recover_runtime_pid_from_probe",
        lambda _record, _probe: 456,
    )
    monkeypatch.setattr(
        ability,
        "_sample_process_tree_metrics",
        lambda pid, **_kwargs: {
            "resource_type": "robotick_launcher_runtime_metrics",
            "root_pid": pid,
        },
    )

    projection = ability._runtime_live_projection(
        {
            "id": "runtime-1",
            "project_id": "barr-e",
            "project_path": "/project",
            "model_id": "barr-e-face",
            "pid": 123,
            "telemetry_port": 9030,
        }
    )

    assert projection["pid"] == 456
    assert projection["pid_alive"] is True
    assert projection["metrics"]["root_pid"] == 456
