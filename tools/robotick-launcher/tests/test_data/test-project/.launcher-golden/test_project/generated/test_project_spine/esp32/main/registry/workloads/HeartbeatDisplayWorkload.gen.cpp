// Auto-generated registration for HeartbeatDisplayWorkload

#include "robotick/workloads/ui/HeartbeatDisplayWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(HeartbeatDisplayConfig)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayConfig, bool, enabled)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayConfig, float, rest_heart_rate)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayConfig, RenderMode, render_mode)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayConfig, uint32_t, max_output_bytes)
    ROBOTICK_REGISTER_STRUCT_END(HeartbeatDisplayConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(HeartbeatDisplayInputs)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayInputs, FixedString8, bar1_label)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayInputs, float, bar1_fraction)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayInputs, FixedString8, bar2_label)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayInputs, float, bar2_fraction)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayInputs, FixedString8, bar3_label)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayInputs, float, bar3_fraction)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayInputs, FixedString8, bar4_label)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayInputs, float, bar4_fraction)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayInputs, float, heart_rate_scale)
    ROBOTICK_REGISTER_STRUCT_END(HeartbeatDisplayInputs)

    ROBOTICK_REGISTER_STRUCT_BEGIN(HeartbeatDisplayOutputs)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayOutputs, float, activation_amount)
    ROBOTICK_STRUCT_FIELD(HeartbeatDisplayOutputs, ImagePngDynamic, display_png)
    ROBOTICK_REGISTER_STRUCT_END(HeartbeatDisplayOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        HeartbeatDisplayWorkload,
        &s_type_desc_HeartbeatDisplayConfig,
        &s_type_desc_HeartbeatDisplayInputs,
        &s_type_desc_HeartbeatDisplayOutputs
    );

} // namespace robotick
