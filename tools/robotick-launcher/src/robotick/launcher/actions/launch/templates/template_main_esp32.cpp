// Auto-generated {{filename}}

#include "robotick/framework/CommonMain.h"

// Declare generated model function (no need for full header)
void populate_model_{{model_name_safe}}(robotick::Model& model);

// Constants for engine task configuration
static constexpr const char* ENGINE_TASK_NAME = "robotick_main";
static constexpr uint32_t ENGINE_STACK_SIZE = 8192; // in bytes
static constexpr UBaseType_t ENGINE_TASK_PRIORITY = 5;
static constexpr BaseType_t ENGINE_CORE_ID = 1;

void run_engine_on_core1(void* param)
{
	// Instantiate and populate model
	robotick::Model model;
	populate_model_{{model_name_safe}}(model);

	// Load and run engine
	ROBOTICK_INFO("{{ model_name }} - loading engine...");
	robotick::Engine engine;
	engine.load(model);

	ROBOTICK_INFO("{{ model_name }} - running engine...");
	robotick::AtomicFlag dummy_flag{false};
	engine.run(dummy_flag);

	ROBOTICK_INFO("{{ model_name }} - exited engine...");
}

ROBOTICK_ENTRYPOINT
{
	ROBOTICK_INFO("Starting Robotick engine on 'esp32' for model '{{ model_name }}'...");

	xTaskCreatePinnedToCore(run_engine_on_core1, ENGINE_TASK_NAME, ENGINE_STACK_SIZE, nullptr, ENGINE_TASK_PRIORITY, nullptr, ENGINE_CORE_ID);
}
