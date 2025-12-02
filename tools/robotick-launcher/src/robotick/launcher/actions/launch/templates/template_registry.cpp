// Auto-generated workload registry

// Workload extras (e.g. systems):
{% for inc in platform_extra_cpp %}
#include "{{ inc }}"
{% endfor %}

// Workloads:
{% for w in workloads %}
#include "workloads/{{ w.filename }}"
{% endfor %}
