// Auto-generated {{filename}}

#include "robotick/framework/CommonMain.h"
#include "robotick/framework/services/NetworkManager.h"

// Declare generated model function (no need for full header)
void populate_model_{{model_name_safe}}(robotick::Model& model);

// Global stop flag used by engine
robotick::AtomicFlag g_stop_flag;

// Signal handler for graceful shutdown
void signal_handler()
{
	g_stop_flag.set();
}

static void initialize_network_runtime()
{
{% if network and network.role == "hotspot_host" %}
	// The Pi5 keeps its main-network reachability on a separate interface while this
	// model brings up the robot-private hotspot used by the CoreS3.
	robotick::NetworkHotspotConfig network_cfg;
	network_cfg.iface = "{{ network.hotspot_iface }}";
	network_cfg.connection_name = "{{ network.hotspot_connection_name }}";
	network_cfg.ssid = "{{ network.ssid }}";
	network_cfg.password = "{{ network.password }}";
	network_cfg.ipv4_address_cidr = "{{ network.hotspot_ipv4_address_cidr }}";
	if (!robotick::NetworkHotspot::start(network_cfg))
	{
		ROBOTICK_FATAL_EXIT("Failed to start robot hotspot '%s' on %s",
			network_cfg.ssid.c_str(),
			network_cfg.iface.c_str());
	}
{% endif %}
}

ROBOTICK_ENTRYPOINT
{
	ROBOTICK_INFO("Starting Robotick engine on '{{config.target}}' for model '{{ model_name }}'...");

	// Handle Ctrl+C
	robotick::setup_exit_handler(signal_handler);
	initialize_network_runtime();

	// Instantiate and populate model
	robotick::Model model;
	populate_model_{{model_name_safe}}(model);

	// Load and run engine
	robotick::Engine engine;
	engine.load(model);
	engine.run(g_stop_flag);
}
