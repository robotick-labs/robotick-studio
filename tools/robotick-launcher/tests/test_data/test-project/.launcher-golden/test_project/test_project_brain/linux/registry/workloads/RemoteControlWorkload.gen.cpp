// Auto-generated registration for RemoteControlWorkload

#include "robotick/workloads/control/RemoteControlWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(RemoteControlConfig)
    ROBOTICK_STRUCT_FIELD(RemoteControlConfig, int, port)
    ROBOTICK_STRUCT_FIELD(RemoteControlConfig, FixedString128, web_root_folder)
    ROBOTICK_REGISTER_STRUCT_END(RemoteControlConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(RemoteControlInputs)
    ROBOTICK_STRUCT_FIELD(RemoteControlInputs, bool, use_web_inputs)
    ROBOTICK_STRUCT_FIELD(RemoteControlInputs, Vec2f, left)
    ROBOTICK_STRUCT_FIELD(RemoteControlInputs, Vec2f, right)
    ROBOTICK_STRUCT_FIELD(RemoteControlInputs, FixedVector128k, jpeg_data)
    ROBOTICK_REGISTER_STRUCT_END(RemoteControlInputs)

    ROBOTICK_REGISTER_STRUCT_BEGIN(RemoteControlOutputs)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, Vec2f, left)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, Vec2f, right)
    ROBOTICK_REGISTER_STRUCT_END(RemoteControlOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        RemoteControlWorkload,
        &s_type_desc_RemoteControlConfig,
        &s_type_desc_RemoteControlInputs,
        &s_type_desc_RemoteControlOutputs
    );

} // namespace robotick
