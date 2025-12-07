// Auto-generated registration for SpeechToTextWorkload

#include "robotick/workloads/auditory/SpeechToTextWorkload.cpp"

namespace robotick
{
    ROBOTICK_REGISTER_STRUCT_BEGIN(SpeechToTextConfig)
    ROBOTICK_STRUCT_FIELD(SpeechToTextConfig, SpeechToTextSettings, settings)
    ROBOTICK_REGISTER_STRUCT_END(SpeechToTextConfig)

    ROBOTICK_REGISTER_STRUCT_BEGIN(SpeechToTextInputs)
    ROBOTICK_STRUCT_FIELD(SpeechToTextInputs, AudioFrame, mono)
    ROBOTICK_REGISTER_STRUCT_END(SpeechToTextInputs)

    ROBOTICK_REGISTER_STRUCT_BEGIN(SpeechToTextOutputs)
    ROBOTICK_STRUCT_FIELD(SpeechToTextOutputs, TranscribedWords, words)
    ROBOTICK_STRUCT_FIELD(SpeechToTextOutputs, FixedString512, transcript)
    ROBOTICK_REGISTER_STRUCT_END(SpeechToTextOutputs)

    ROBOTICK_REGISTER_WORKLOAD_BASE(
        SpeechToTextWorkload,
        &s_type_desc_SpeechToTextConfig,
        &s_type_desc_SpeechToTextInputs,
        &s_type_desc_SpeechToTextOutputs
    );

} // namespace robotick
