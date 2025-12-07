// Auto-generated registration for SteeringMixerWorkload

#include "robotick/workloads/control/SteeringMixerWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(SteeringMixerConfig)
    ROBOTICK_STRUCT_FIELD(SteeringMixerConfig, float, max_speed_differential)
    ROBOTICK_STRUCT_FIELD(SteeringMixerConfig, float, power_scale_both)
    ROBOTICK_STRUCT_FIELD(SteeringMixerConfig, float, power_scale_left)
    ROBOTICK_STRUCT_FIELD(SteeringMixerConfig, float, power_scale_right)
    ROBOTICK_REGISTER_STRUCT_END(SteeringMixerConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(SteeringMixerInputs)
    ROBOTICK_STRUCT_FIELD(SteeringMixerInputs, float, speed)
    ROBOTICK_STRUCT_FIELD(SteeringMixerInputs, float, turn_rate)
    ROBOTICK_REGISTER_STRUCT_END(SteeringMixerInputs)

    ROBOTICK_REGISTER_STRUCT_BEGIN(SteeringMixerOutputs)
    ROBOTICK_STRUCT_FIELD(SteeringMixerOutputs, float, left_motor)
    ROBOTICK_STRUCT_FIELD(SteeringMixerOutputs, float, right_motor)
    ROBOTICK_REGISTER_STRUCT_END(SteeringMixerOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        SteeringMixerWorkload,
        &s_type_desc_SteeringMixerConfig,
        &s_type_desc_SteeringMixerInputs,
        &s_type_desc_SteeringMixerOutputs
    );

} // namespace robotick
