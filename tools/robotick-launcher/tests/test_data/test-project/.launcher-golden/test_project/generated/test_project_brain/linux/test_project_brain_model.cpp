// Auto-generated model: Test-Project-Brain
#include "robotick/api.h"

using namespace robotick;

namespace robotick
{
    void ensure_workloads()
    {
        ROBOTICK_KEEP_WORKLOAD(RemoteControlWorkload)
        ROBOTICK_KEEP_WORKLOAD(FaceDisplayWorkload)
        ROBOTICK_KEEP_WORKLOAD(SpeechToTextWorkload)
        ROBOTICK_KEEP_WORKLOAD(CameraWorkload)
        ROBOTICK_KEEP_WORKLOAD(SyncedGroupWorkload)
    }
    
} // namespace robotick

void populate_model_test_project_brain(robotick::Model& model)
{
    ensure_workloads();

    // === Workloads ===
    static const FieldConfigEntry remote_control_initial_inputs[] = {
        {"use_web_inputs", "True"},
        {"left.x", "0.0"},
        {"left.y", "0.0"}
    };

    static const WorkloadSeed remote_control = {
        TypeId("RemoteControlWorkload"),
        StringView("remote_control"),
        30.0f,
        {},    // children
        {},    // config
        remote_control_initial_inputs,
    };

    static const FieldConfigEntry face_config[] = {
        {"blink_min_interval_sec", "1.5"},
        {"blink_max_interval_sec", "4.0"},
        {"render_to_texture", "True"}
    };

    static const WorkloadSeed face = {
        TypeId("FaceDisplayWorkload"),
        StringView("face"),
        30.0f,
        {},    // children
        face_config,
        {}    // inputs
    };


    static const WorkloadSeed speech_to_text = {
        TypeId("SpeechToTextWorkload"),
        StringView("speech_to_text"),
        30.0f,
        {},    // children
        {},    // config
        {}    // inputs
    };


    static const WorkloadSeed camera = {
        TypeId("CameraWorkload"),
        StringView("camera"),
        30.0f,
        {},    // children
        {},    // config
        {}    // inputs
    };

    static const WorkloadSeed* const root_group_children[] = {
        &remote_control,        &face,        &camera,        &speech_to_text    };


    static const WorkloadSeed root_group = {
        TypeId("SyncedGroupWorkload"),
        StringView("root_group"),
        30.0f,
        root_group_children,
        {},    // config
        {}    // inputs
    };

    static const WorkloadSeed* const all_workloads[] = {
        &remote_control,
        &face,
        &speech_to_text,
        &camera,
        &root_group
    };

    // === Local data connections ===



    // === Remote models ===

    static const DataConnectionSeed spine_conn_steering_mixer_inputs_turn_rate{
        "remote_control.outputs.left.x",
        "steering_mixer.inputs.turn_rate"
    };

    static const DataConnectionSeed spine_conn_steering_mixer_inputs_speed{
        "remote_control.outputs.left.y",
        "steering_mixer.inputs.speed"
    };

    static const DataConnectionSeed* const spine_connections[] = {
        &spine_conn_steering_mixer_inputs_turn_rate,
        &spine_conn_steering_mixer_inputs_speed
    };

    static const RemoteModelSeed remote_spine{
        "spine",
        spine_connections
    };

    static const RemoteModelSeed* const all_remote_models[] = {
        &remote_spine        
    };

    // === Finalize model ===

    model.set_model_name("test-project-brain");
    model.use_workload_seeds(all_workloads);
    model.use_remote_models(all_remote_models);
    model.set_root_workload(root_group);
    model.set_telemetry_port(7090);
}