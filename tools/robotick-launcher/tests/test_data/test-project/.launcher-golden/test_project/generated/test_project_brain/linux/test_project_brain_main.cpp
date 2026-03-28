// Auto-generated test_project_brain_main.cpp

#include "robotick/framework/CommonMain.h"
#include "robotick/framework/services/NetworkManager.h"

// Declare generated model function (no need for full header)
void populate_model_test_project_brain(robotick::Model& model);

// Global stop flag used by engine
robotick::AtomicFlag g_stop_flag;

// Signal handler for graceful shutdown
void signal_handler()
{
	g_stop_flag.set();
}

static void initialize_network_runtime()
{
}

ROBOTICK_ENTRYPOINT
{
	ROBOTICK_INFO("Starting Robotick engine on 'linux' for model 'test-project-brain'...");

	// Handle Ctrl+C
	robotick::setup_exit_handler(signal_handler);
	initialize_network_runtime();

	// Instantiate and populate model
	robotick::Model model;
	populate_model_test_project_brain(model);

	// Load and run engine
	robotick::Engine engine;
	engine.load(model);
	engine.run(g_stop_flag);
}