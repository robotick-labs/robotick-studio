// Auto-generated model: Test-Project-Spine
#include "robotick/api.h"

using namespace robotick;

namespace robotick
{
    void ensure_workloads()
    {
        ROBOTICK_KEEP_WORKLOAD(SteeringMixerWorkload)
        ROBOTICK_KEEP_WORKLOAD(BaseXWorkload)
        ROBOTICK_KEEP_WORKLOAD(SequencedGroupWorkload)
        ROBOTICK_KEEP_WORKLOAD(HeartbeatDisplayWorkload)
        ROBOTICK_KEEP_WORKLOAD(SequencedGroupWorkload)
    }
    
} // namespace robotick

void populate_model_test_project_spine(robotick::Model& model)
{
    ensure_workloads();

    // === Workloads ===

    static const WorkloadSeed steering_mixer_workload_31EFA630 = {
        TypeId("SteeringMixerWorkload"),
        StringView("steering_mixer_workload_31EFA630"),
        30.0f,
        {},    // children
        {},    // config
        {},    // inputs
        StringView("steering_mixer")
    };


    static const WorkloadSeed base_xworkload_B49D2AF7 = {
        TypeId("BaseXWorkload"),
        StringView("base_xworkload_B49D2AF7"),
        30.0f,
        {},    // children
        {},    // config
        {},    // inputs
        StringView("basex")
    };

    static const WorkloadSeed* const sequenced_group_workload_5AB6C106_children[] = {
        &steering_mixer_workload_31EFA630,        &base_xworkload_B49D2AF7    };


    static const WorkloadSeed sequenced_group_workload_5AB6C106 = {
        TypeId("SequencedGroupWorkload"),
        StringView("sequenced_group_workload_5AB6C106"),
        30.0f,
        sequenced_group_workload_5AB6C106_children,
        {},    // config
        {},    // inputs
        StringView("control_sequence")
    };

    static const FieldConfigEntry heartbeat_display_workload_726A380B_config[] = {
        {"render_to_texture", "true"}
    };

    static const WorkloadSeed heartbeat_display_workload_726A380B = {
        TypeId("HeartbeatDisplayWorkload"),
        StringView("heartbeat_display_workload_726A380B"),
        30.0f,
        {},    // children
        heartbeat_display_workload_726A380B_config,
        {},    // inputs
        StringView("heart_ui")
    };

    static const WorkloadSeed* const sequenced_group_workload_41F3A4E9_children[] = {
        &sequenced_group_workload_5AB6C106,        &heartbeat_display_workload_726A380B    };


    static const WorkloadSeed sequenced_group_workload_41F3A4E9 = {
        TypeId("SequencedGroupWorkload"),
        StringView("sequenced_group_workload_41F3A4E9"),
        30.0f,
        sequenced_group_workload_41F3A4E9_children,
        {},    // config
        {},    // inputs
        StringView("esp32_root")
    };

    static const WorkloadSeed* const all_workloads[] = {
        &steering_mixer_workload_31EFA630,
        &base_xworkload_B49D2AF7,
        &sequenced_group_workload_5AB6C106,
        &heartbeat_display_workload_726A380B,
        &sequenced_group_workload_41F3A4E9
    };

    // === Local data connections ===

    static const DataConnectionSeed conn_base_xworkload_B49D2AF7_inputs_motor1_speed{
        "steering_mixer_workload_31EFA630.outputs.left_motor",
        "base_xworkload_B49D2AF7.inputs.motor1_speed"
    };
    static const DataConnectionSeed conn_base_xworkload_B49D2AF7_inputs_motor2_speed{
        "steering_mixer_workload_31EFA630.outputs.right_motor",
        "base_xworkload_B49D2AF7.inputs.motor2_speed"
    };

    static const DataConnectionSeed* const all_connections[] = {
        &conn_base_xworkload_B49D2AF7_inputs_motor1_speed, 
        &conn_base_xworkload_B49D2AF7_inputs_motor2_speed
    };
    // === Finalize model ===

    model.set_model_name("test_project_spine_model_90287511");
    model.use_workload_seeds(all_workloads);
    model.use_data_connection_seeds(all_connections);
    model.set_root_workload(sequenced_group_workload_41F3A4E9);
    model.set_telemetry_port(7091);
    model.set_telemetry_push_rate_hz(20.0f);
}
