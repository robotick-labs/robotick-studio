// Auto-generated registration for RemoteControlWorkload

#include "robotick/workloads/control/RemoteControlWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(RemoteControlConfig)
    ROBOTICK_STRUCT_FIELD(RemoteControlConfig, Vec2f, dead_zone_left)
    ROBOTICK_STRUCT_FIELD(RemoteControlConfig, Vec2f, dead_zone_right)
    ROBOTICK_STRUCT_FIELD(RemoteControlConfig, StickShapeTransform, stick_shape_transform_left)
    ROBOTICK_STRUCT_FIELD(RemoteControlConfig, StickShapeTransform, stick_shape_transform_right)
    ROBOTICK_REGISTER_STRUCT_END(RemoteControlConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(RemoteControlInputs)
    ROBOTICK_STRUCT_FIELD(RemoteControlInputs, bool, use_web_inputs)
    ROBOTICK_STRUCT_FIELD(RemoteControlInputs, GamepadState, gamepad_state_raw)
    ROBOTICK_REGISTER_STRUCT_END(RemoteControlInputs)

    ROBOTICK_REGISTER_STRUCT_BEGIN(RemoteControlOutputs)
    ROBOTICK_STRUCT_FIELD(RemoteControlOutputs, GamepadState, gamepad_state)
    ROBOTICK_REGISTER_STRUCT_END(RemoteControlOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        RemoteControlWorkload,
        &s_type_desc_RemoteControlConfig,
        &s_type_desc_RemoteControlInputs,
        &s_type_desc_RemoteControlOutputs
    );

} // namespace robotick
