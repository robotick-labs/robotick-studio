// Auto-generated registration for MicWorkload

#include "robotick/workloads/audio/MicWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(MicInputs)
    ROBOTICK_STRUCT_FIELD(MicInputs, float, amplitude_gain_db)
    ROBOTICK_REGISTER_STRUCT_END(MicInputs)

    ROBOTICK_REGISTER_STRUCT_BEGIN(MicOutputs)
    ROBOTICK_STRUCT_FIELD(MicOutputs, AudioFrame, mono)
    ROBOTICK_STRUCT_FIELD(MicOutputs, bool, success)
    ROBOTICK_STRUCT_FIELD(MicOutputs, AudioQueueResult, last_read_status)
    ROBOTICK_STRUCT_FIELD(MicOutputs, uint32_t, dropped_reads)
    ROBOTICK_REGISTER_STRUCT_END(MicOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        MicWorkload,
        nullptr,
        &s_type_desc_MicInputs,
        &s_type_desc_MicOutputs
    );

} // namespace robotick
