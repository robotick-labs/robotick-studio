// Auto-generated registration for MonocularCameraWorkload

#include "robotick/workloads/sensors/MonocularCameraWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(MonocularCameraConfig)
    ROBOTICK_STRUCT_FIELD(MonocularCameraConfig, int, camera_index)
    ROBOTICK_STRUCT_FIELD(MonocularCameraConfig, uint32_t, capture_width)
    ROBOTICK_STRUCT_FIELD(MonocularCameraConfig, uint32_t, capture_height)
    ROBOTICK_STRUCT_FIELD(MonocularCameraConfig, uint32_t, stream_id)
    ROBOTICK_REGISTER_STRUCT_END(MonocularCameraConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(MonocularCameraOutputs)
    ROBOTICK_STRUCT_FIELD(MonocularCameraOutputs, ImageRef, image)
    ROBOTICK_REGISTER_STRUCT_END(MonocularCameraOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        MonocularCameraWorkload,
        &s_type_desc_MonocularCameraConfig,
        nullptr,
        &s_type_desc_MonocularCameraOutputs
    );

} // namespace robotick
