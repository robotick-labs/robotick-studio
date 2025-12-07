// Auto-generated registration for FaceDisplayWorkload

#include "robotick/workloads/ui/FaceDisplayWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(FaceDisplayConfig)
    ROBOTICK_STRUCT_FIELD(FaceDisplayConfig, float, blink_min_interval_sec)
    ROBOTICK_STRUCT_FIELD(FaceDisplayConfig, float, blink_max_interval_sec)
    ROBOTICK_REGISTER_STRUCT_END(FaceDisplayConfig)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        FaceDisplayWorkload,
        &s_type_desc_FaceDisplayConfig,
        nullptr,
        nullptr
    );

} // namespace robotick
