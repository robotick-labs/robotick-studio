// Auto-generated model: {{ config.model_name | replace("_", " ") | title }}
#include "robotick/api.h"

using namespace robotick;

namespace robotick
{
    void ensure_workloads()
    {
        {% for w in workloads %}
        ROBOTICK_KEEP_WORKLOAD({{ w.type }})
        {% endfor %}
    }
    
} // namespace robotick

void populate_model_{{ config.model_name_safe }}(robotick::Model& model)
{
    ensure_workloads();

    // === Workloads ===
    {% for w in workloads %}
    {% if w.children %}
    static const WorkloadSeed* const {{ w.var_name }}_children[] = {
    {% for child in w.children %}
        &{{ child.replace("-", "_") }}{% if not loop.last %},{% endif %}
    {% endfor %}
    };

    {% endif %}
    {% if w.config_entries %}
    static const FieldConfigEntry {{ w.var_name }}_config[] = {
    {% for entry in w.config_entries_render %}
        {"{{ entry.key }}", "{{ entry.value_normalized }}"}{% if not loop.last %},
        {% endif %}
    {% endfor %}

    };
    {% endif %}
    {% if w.input_entries %}
    static const FieldConfigEntry {{ w.var_name }}_initial_inputs[] = {
    {% for entry in w.input_entries_render %}
        {"{{ entry.key }}", "{{ entry.value_normalized }}"}{% if not loop.last %},
        {% endif %}
    {% endfor %}

    };
    {% endif %}

    static const WorkloadSeed {{ w.var_name }} = {
        TypeId("{{ w.type }}"),
        StringView("{{ w.name }}"),
        {% if w.tick_rate_hz %}
        {{ w.tick_rate_hz }}f,
        {% else %}
        -1.0f, // tick_rate_hz
        {% endif %}
        {% if w.children %}
        {{ w.var_name }}_children,
        {% else %}
        {},    // children
        {% endif %}
        {% if w.config_entries %}
        {{ w.var_name }}_config,
        {% else %}
        {},    // config
        {% endif %}
        {% if w.input_entries %}
        {{ w.var_name }}_initial_inputs,
        {% else %}
        {}    // inputs
        {% endif %}
    };

    {% endfor %}
    static const WorkloadSeed* const all_workloads[] = {
    {% for w in workloads %}
        &{{ w.var_name }}{% if not loop.last %},{% endif %}

    {% endfor %}
    };

    // === Local data connections ===

    {% for conn in connections %}
    static const DataConnectionSeed {{ conn.var_name }}{
        "{{ conn.from }}",
        "{{ conn.to }}"
    };
    {% endfor %}

    {% if connections %}
    static const DataConnectionSeed* const all_connections[] = {
    {% for conn in connections %}
        &{{ conn.var_name }}{% if not loop.last %}, {% endif %}

    {% endfor %}
    };{% endif %}
    {% if remote_models %}

    // === Remote models ===

    {% for remote in remote_models %}
        {% for conn in remote.connections %}
    static const DataConnectionSeed {{ conn.var_name }}{
        "{{ conn.from }}",
        "{{ conn.to_remote }}"
    };

        {% endfor %}
    static const DataConnectionSeed* const {{ remote.name_safe }}_connections[] = {
        {% for conn in remote.connections %}
        &{{ conn.var_name }}{% if not loop.last %},{% endif %}

        {% endfor %}
    };

    static const RemoteModelSeed remote_{{ remote.name_safe }}{
        "{{ remote.name }}",
        {{ remote.name_safe }}_connections
    };
    {% endfor %}

    static const RemoteModelSeed* const all_remote_models[] = {
        {% for remote in remote_models %}
        &remote_{{ remote.name_safe }}{% if not loop.last %}, {% endif %}
        
        {% endfor %}
    };
    {% endif %}

    // === Finalize model ===

    model.set_model_name("{{config.model_name}}");
    model.use_workload_seeds(all_workloads);
    {% if connections %}
    model.use_data_connection_seeds(all_connections);
    {% endif %}
    {% if remote_models %}
    model.use_remote_models(all_remote_models);
    {% endif %}
    model.set_root_workload({{config.model.root}});
    {% if telemetry and telemetry.port %}
    model.set_telemetry_port({{telemetry.port}});
    {% endif %}
}
