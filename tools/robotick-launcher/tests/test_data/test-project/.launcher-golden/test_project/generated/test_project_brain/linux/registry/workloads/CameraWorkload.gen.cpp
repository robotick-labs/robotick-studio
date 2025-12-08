// Auto-generated registration for CameraWorkload

#include "robotick/workloads/sensors/CameraWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(CameraConfig)
    ROBOTICK_STRUCT_FIELD(CameraConfig, int, camera_index)
    ROBOTICK_REGISTER_STRUCT_END(CameraConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(CameraOutputs)
    ROBOTICK_STRUCT_FIELD(CameraOutputs, FixedVector128k, jpeg_data)
    ROBOTICK_REGISTER_STRUCT_END(CameraOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        CameraWorkload,
        &s_type_desc_CameraConfig,
        nullptr,
        &s_type_desc_CameraOutputs
    );

} // namespace robotick
