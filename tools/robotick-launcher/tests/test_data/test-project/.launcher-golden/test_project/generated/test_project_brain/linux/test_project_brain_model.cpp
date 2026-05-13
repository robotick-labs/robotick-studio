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
        ROBOTICK_KEEP_WORKLOAD(MonocularCameraWorkload)
        ROBOTICK_KEEP_WORKLOAD(MicWorkload)
        ROBOTICK_KEEP_WORKLOAD(SyncedGroupWorkload)
    }
    
} // namespace robotick

void populate_model_test_project_brain(robotick::Model& model)
{
    ensure_workloads();

    // === Workloads ===
    static const FieldConfigEntry remote_control_workload_59511193_initial_inputs[] = {
        {"use_web_inputs", "true"},
        {"left.x", "0.0"},
        {"left.y", "0.0"}
    };

    static const WorkloadSeed remote_control_workload_59511193 = {
        TypeId("RemoteControlWorkload"),
        StringView("remote_control_workload_59511193"),
        30.0f,
        {},    // children
        {},    // config
        remote_control_workload_59511193_initial_inputs,
    };

    static const FieldConfigEntry face_display_workload_EE6DA533_config[] = {
        {"blink_min_interval_sec", "1.5"},
        {"blink_max_interval_sec", "4.0"},
        {"render_to_texture", "true"}
    };

    static const WorkloadSeed face_display_workload_EE6DA533 = {
        TypeId("FaceDisplayWorkload"),
        StringView("face_display_workload_EE6DA533"),
        30.0f,
        {},    // children
        face_display_workload_EE6DA533_config,
        {}    // inputs
    };


    static const WorkloadSeed speech_to_text_workload_8363FFF6 = {
        TypeId("SpeechToTextWorkload"),
        StringView("speech_to_text_workload_8363FFF6"),
        30.0f,
        {},    // children
        {},    // config
        {}    // inputs
    };


    static const WorkloadSeed monocular_camera_workload_09BDDA25 = {
        TypeId("MonocularCameraWorkload"),
        StringView("monocular_camera_workload_09BDDA25"),
        30.0f,
        {},    // children
        {},    // config
        {}    // inputs
    };


    static const WorkloadSeed mic_workload_87EF9860 = {
        TypeId("MicWorkload"),
        StringView("mic_workload_87EF9860"),
        30.0f,
        {},    // children
        {},    // config
        {}    // inputs
    };

    static const WorkloadSeed* const synced_group_workload_E6E41091_children[] = {
        &remote_control_workload_59511193,        &face_display_workload_EE6DA533,        &monocular_camera_workload_09BDDA25,        &mic_workload_87EF9860,        &speech_to_text_workload_8363FFF6    };


    static const WorkloadSeed synced_group_workload_E6E41091 = {
        TypeId("SyncedGroupWorkload"),
        StringView("synced_group_workload_E6E41091"),
        30.0f,
        synced_group_workload_E6E41091_children,
        {},    // config
        {}    // inputs
    };

    static const WorkloadSeed* const all_workloads[] = {
        &remote_control_workload_59511193,
        &face_display_workload_EE6DA533,
        &speech_to_text_workload_8363FFF6,
        &monocular_camera_workload_09BDDA25,
        &mic_workload_87EF9860,
        &synced_group_workload_E6E41091
    };

    // === Local data connections ===



    // === Remote models ===

    static const DataConnectionSeed test_project_spine_model_90287511_conn_remote_control_workload_59511193_outputs_left_y__to__steering_mixer_workload_31EFA630_inputs_speed{
        "remote_control_workload_59511193.outputs.left.y",
        "steering_mixer_workload_31EFA630.inputs.speed"
    };

    static const DataConnectionSeed test_project_spine_model_90287511_conn_remote_control_workload_59511193_outputs_left_x__to__steering_mixer_workload_31EFA630_inputs_turn_rate{
        "remote_control_workload_59511193.outputs.left.x",
        "steering_mixer_workload_31EFA630.inputs.turn_rate"
    };

    static const DataConnectionSeed* const test_project_spine_model_90287511_connections[] = {
        &test_project_spine_model_90287511_conn_remote_control_workload_59511193_outputs_left_y__to__steering_mixer_workload_31EFA630_inputs_speed,
        &test_project_spine_model_90287511_conn_remote_control_workload_59511193_outputs_left_x__to__steering_mixer_workload_31EFA630_inputs_turn_rate
    };

    static const RemoteModelSeed remote_test_project_spine_model_90287511 = []() {
        RemoteModelSeed seed{
            "test_project_spine_model_90287511",
            test_project_spine_model_90287511_connections
        };
        seed.comms_mode = RemoteModelSeed::Mode::IP;
        return seed;
    }();

    static const RemoteModelSeed* const all_remote_models[] = {
        &remote_test_project_spine_model_90287511        
    };

    // === Finalize model ===

    model.set_model_name("test_project_brain_model_20D4813E");
    model.use_workload_seeds(all_workloads);
    model.use_remote_models(all_remote_models);
    model.set_root_workload(synced_group_workload_E6E41091);
    model.set_telemetry_port(7090);
    model.set_telemetry_push_rate_hz(20.0f);
}