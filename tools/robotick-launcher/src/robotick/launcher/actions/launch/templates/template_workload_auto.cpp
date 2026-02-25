// Auto-generated registration for {{ type }}

#include "{{ workload_include }}"

namespace robotick
{
    {% if config_struct != 'void' %}
    ROBOTICK_REGISTER_STRUCT_BEGIN({{ config_struct }})
    {% for f in config_fields %}
    ROBOTICK_STRUCT_FIELD({{ config_struct }}, {{ f.type }}, {{ f.name }})
    {% endfor %}
    ROBOTICK_REGISTER_STRUCT_END({{ config_struct }})

    {% endif %}
    {% if inputs_struct != 'void' %}
    ROBOTICK_REGISTER_STRUCT_BEGIN({{ inputs_struct }})
    {% for f in inputs_fields %}
    ROBOTICK_STRUCT_FIELD({{ inputs_struct }}, {{ f.type }}, {{ f.name }})
    {% endfor %}
    ROBOTICK_REGISTER_STRUCT_END({{ inputs_struct }})

    {% endif %}
    {% if outputs_struct != 'void' %}
    ROBOTICK_REGISTER_STRUCT_BEGIN({{ outputs_struct }})
    {% for f in outputs_fields %}
    ROBOTICK_STRUCT_FIELD({{ outputs_struct }}, {{ f.type }}, {{ f.name }})
    {% endfor %}
    ROBOTICK_REGISTER_STRUCT_END({{ outputs_struct }})

    {% endif %}
    ROBOTICK_REGISTER_WORKLOAD_BASE(
        {{ type }},
        {{ "nullptr" if config_struct == "void" else "&s_type_desc_" + config_struct }},
        {{ "nullptr" if inputs_struct == "void" else "&s_type_desc_" + inputs_struct }},
        {{ "nullptr" if outputs_struct == "void" else "&s_type_desc_" + outputs_struct }}
    );

} // namespace robotick

