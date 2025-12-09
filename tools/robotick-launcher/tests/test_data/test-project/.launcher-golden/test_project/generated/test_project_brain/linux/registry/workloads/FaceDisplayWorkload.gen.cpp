// Auto-generated registration for FaceDisplayWorkload

#include "robotick/workloads/ui/FaceDisplayWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(FaceDisplayConfig)
    ROBOTICK_STRUCT_FIELD(FaceDisplayConfig, float, blink_min_interval_sec)
    ROBOTICK_STRUCT_FIELD(FaceDisplayConfig, float, blink_max_interval_sec)
    ROBOTICK_STRUCT_FIELD(FaceDisplayConfig, bool, render_to_texture)
    ROBOTICK_STRUCT_FIELD(FaceDisplayConfig, Vec2f, look_offset_scale)
    ROBOTICK_REGISTER_STRUCT_END(FaceDisplayConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(FaceDisplayInputs)
    ROBOTICK_STRUCT_FIELD(FaceDisplayInputs, Vec2f, look_offset)
    ROBOTICK_STRUCT_FIELD(FaceDisplayInputs, bool, blink_request)
    ROBOTICK_STRUCT_FIELD(FaceDisplayInputs, float, max_eyes_open_norm)
    ROBOTICK_REGISTER_STRUCT_END(FaceDisplayInputs)

    ROBOTICK_REGISTER_STRUCT_BEGIN(FaceDisplayOutputs)
    ROBOTICK_STRUCT_FIELD(FaceDisplayOutputs, ImagePng16k, face_png_data)
    ROBOTICK_REGISTER_STRUCT_END(FaceDisplayOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        FaceDisplayWorkload,
        &s_type_desc_FaceDisplayConfig,
        &s_type_desc_FaceDisplayInputs,
        &s_type_desc_FaceDisplayOutputs
    );

} // namespace robotick
