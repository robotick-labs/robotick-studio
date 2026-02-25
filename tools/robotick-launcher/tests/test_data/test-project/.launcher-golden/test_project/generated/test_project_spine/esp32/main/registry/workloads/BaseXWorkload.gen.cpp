// Auto-generated registration for BaseXWorkload

#include "robotick/workloads/actuators/BaseXWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(BaseXConfig)
    ROBOTICK_STRUCT_FIELD(BaseXConfig, float, max_motor_speed)
    ROBOTICK_REGISTER_STRUCT_END(BaseXConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(BaseXInputs)
    ROBOTICK_STRUCT_FIELD(BaseXInputs, float, motor1_speed)
    ROBOTICK_STRUCT_FIELD(BaseXInputs, float, motor2_speed)
    ROBOTICK_STRUCT_FIELD(BaseXInputs, float, motor3_speed)
    ROBOTICK_STRUCT_FIELD(BaseXInputs, float, motor4_speed)
    ROBOTICK_REGISTER_STRUCT_END(BaseXInputs)

    ROBOTICK_REGISTER_STRUCT_BEGIN(BaseXOutputs)
    ROBOTICK_STRUCT_FIELD(BaseXOutputs, float, motor1_speed)
    ROBOTICK_STRUCT_FIELD(BaseXOutputs, float, motor2_speed)
    ROBOTICK_STRUCT_FIELD(BaseXOutputs, float, motor3_speed)
    ROBOTICK_STRUCT_FIELD(BaseXOutputs, float, motor4_speed)
    ROBOTICK_REGISTER_STRUCT_END(BaseXOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        BaseXWorkload,
        &s_type_desc_BaseXConfig,
        &s_type_desc_BaseXInputs,
        &s_type_desc_BaseXOutputs
    );

} // namespace robotick
