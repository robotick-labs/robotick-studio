// Auto-generated {{filename}}

#include "robotick/framework/CommonMain.h"

// Declare generated model function (no need for full header)
void populate_model_{{model_name_safe}}(robotick::Model& model);

// Global stop flag used by engine
robotick::AtomicFlag g_stop_flag;

// Signal handler for graceful shutdown
void signal_handler()
{
	g_stop_flag.set();
}

ROBOTICK_ENTRYPOINT
{
	ROBOTICK_INFO("Starting Robotick engine on '{{config.target}}' for model '{{ model_name }}'...");

	// Handle Ctrl+C
	robotick::setup_exit_handler(signal_handler);

	// Instantiate and populate model
	robotick::Model model;
	populate_model_{{model_name_safe}}(model);

	// Load and run engine
	robotick::Engine engine;
	engine.load(model);
	engine.run(g_stop_flag);
}
