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

    static const WorkloadSeed steering_mixer = {
        TypeId("SteeringMixerWorkload"),
        StringView("steering_mixer"),
        30.0f,
        {},    // children
        {},    // config
        {}    // inputs
    };


    static const WorkloadSeed basex = {
        TypeId("BaseXWorkload"),
        StringView("basex"),
        30.0f,
        {},    // children
        {},    // config
        {}    // inputs
    };

    static const WorkloadSeed* const control_sequence_children[] = {
        &steering_mixer,        &basex    };


    static const WorkloadSeed control_sequence = {
        TypeId("SequencedGroupWorkload"),
        StringView("control_sequence"),
        30.0f,
        control_sequence_children,
        {},    // config
        {}    // inputs
    };


    static const WorkloadSeed heart_ui = {
        TypeId("HeartbeatDisplayWorkload"),
        StringView("heart_ui"),
        30.0f,
        {},    // children
        {},    // config
        {}    // inputs
    };

    static const WorkloadSeed* const esp32_root_children[] = {
        &control_sequence,        &heart_ui    };


    static const WorkloadSeed esp32_root = {
        TypeId("SequencedGroupWorkload"),
        StringView("esp32_root"),
        30.0f,
        esp32_root_children,
        {},    // config
        {}    // inputs
    };

    static const WorkloadSeed* const all_workloads[] = {
        &steering_mixer,
        &basex,
        &control_sequence,
        &heart_ui,
        &esp32_root
    };

    // === Local data connections ===

    static const DataConnectionSeed conn_basex_inputs_motor1_speed{
        "steering_mixer.outputs.left_motor",
        "basex.inputs.motor1_speed"
    };
    static const DataConnectionSeed conn_basex_inputs_motor2_speed{
        "steering_mixer.outputs.right_motor",
        "basex.inputs.motor2_speed"
    };

    static const DataConnectionSeed* const all_connections[] = {
        &conn_basex_inputs_motor1_speed, 
        &conn_basex_inputs_motor2_speed
    };
    // === Finalize model ===

    model.set_model_name("test-project-spine");
    model.use_workload_seeds(all_workloads);
    model.use_data_connection_seeds(all_connections);
    model.set_root_workload(esp32_root);
    model.set_telemetry_port(7091);
}