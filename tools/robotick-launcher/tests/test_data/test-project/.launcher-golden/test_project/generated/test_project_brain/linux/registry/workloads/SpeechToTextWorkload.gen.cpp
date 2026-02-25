// Auto-generated registration for SpeechToTextWorkload

#include "robotick/workloads/auditory/SpeechToTextWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(SpeechToTextConfig)
    ROBOTICK_STRUCT_FIELD(SpeechToTextConfig, SpeechToTextSettings, settings)
    ROBOTICK_REGISTER_STRUCT_END(SpeechToTextConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(SpeechToTextInputs)
    ROBOTICK_STRUCT_FIELD(SpeechToTextInputs, AudioFrame, mono)
    ROBOTICK_STRUCT_FIELD(SpeechToTextInputs, bool, is_voiced)
    ROBOTICK_REGISTER_STRUCT_END(SpeechToTextInputs)

    ROBOTICK_REGISTER_STRUCT_BEGIN(SpeechToTextOutputs)
    ROBOTICK_STRUCT_FIELD(SpeechToTextOutputs, Transcript, proto_transcript)
    ROBOTICK_STRUCT_FIELD(SpeechToTextOutputs, Transcript, transcript)
    ROBOTICK_STRUCT_FIELD(SpeechToTextOutputs, float, accumulator_duration_sec)
    ROBOTICK_STRUCT_FIELD(SpeechToTextOutputs, float, accumulator_capacity_sec)
    ROBOTICK_STRUCT_FIELD(SpeechToTextOutputs, bool, is_transcribe_thread_active)
    ROBOTICK_STRUCT_FIELD(SpeechToTextOutputs, uint32_t, transcribe_session_count)
    ROBOTICK_REGISTER_STRUCT_END(SpeechToTextOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        SpeechToTextWorkload,
        &s_type_desc_SpeechToTextConfig,
        &s_type_desc_SpeechToTextInputs,
        &s_type_desc_SpeechToTextOutputs
    );

} // namespace robotick
