// Auto-generated workload registry

// Workloads:
{% for w in workloads %}
#include "workloads/{{ w.filename }}"
{% endfor %}
