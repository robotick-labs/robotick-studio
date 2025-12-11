// Auto-generated registration for RemoteControlWorkload

#include "robotick/workloads/control/RemoteControlWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(RemoteControlConfig)
    ROBOTICK_STRUCT_FIELD(RemoteControlConfig, int, port)
    ROBOTICK_STRUCT_FIELD(RemoteControlConfig, FixedString128, web_root_folder)
    ROBOTICK_REGISTER_STRUCT_END(RemoteControlConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(RemoteControlOutputs)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, use_web_inputs)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, Vec2f, left)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, Vec2f, right)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, float, left_trigger)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, float, right_trigger)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, a)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, b)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, x)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, y)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, left_bumper)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, right_bumper)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, back)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, start)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, guide)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, left_stick_button)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, right_stick_button)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, dpad_up)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, dpad_down)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, dpad_left)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, bool, dpad_right)
    ROBOTICK_REGISTER_STRUCT_END(RemoteControlOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        RemoteControlWorkload,
        &s_type_desc_RemoteControlConfig,
        nullptr,
        &s_type_desc_RemoteControlOutputs
    );

} // namespace robotick
