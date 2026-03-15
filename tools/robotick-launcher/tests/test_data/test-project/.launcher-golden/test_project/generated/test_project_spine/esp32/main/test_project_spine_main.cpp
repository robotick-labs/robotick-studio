// Auto-generated test_project_spine_main.cpp

#include "robotick/framework/CommonMain.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "robotick/framework/services/NetworkManager.h"

// Declare generated model function (no need for full header)
void populate_model_test_project_spine(robotick::Model& model);

// Run the engine on its own FreeRTOS task so the generated app_main stays minimal and
// model startup/teardown remains consistent across ESP32 models.
// Constants for engine task configuration
static constexpr const char* ENGINE_TASK_NAME = "robotick_main";
// Telemetry layout generation, Wi-Fi, REC, and display workloads can all be
// live at once on CoreS3-class targets, so keep generous headroom here.
static constexpr uint32_t ENGINE_STACK_SIZE = 32768; // in bytes
static constexpr UBaseType_t ENGINE_TASK_PRIORITY = 5;
static constexpr BaseType_t ENGINE_CORE_ID = 1;

static void initialize_network_runtime()
{
	// RemoteEngineDiscoverer and TelemetryServer can open sockets during engine load,
	// so the ESP32 TCP/IP stack needs to exist before the engine task starts.
	esp_err_t err = esp_netif_init();
	if (err != ESP_OK && err != ESP_ERR_INVALID_STATE)
	{
		ROBOTICK_FATAL_EXIT("Failed to initialize esp_netif (error code %d)", static_cast<int>(err));
	}

	err = esp_event_loop_create_default();
	if (err != ESP_OK && err != ESP_ERR_INVALID_STATE)
	{
		ROBOTICK_FATAL_EXIT("Failed to create default ESP event loop (error code %d)", static_cast<int>(err));
	}

}

void run_engine_on_core1(void* param)
{
	initialize_network_runtime();

	// Instantiate and populate model
	robotick::Model model;
	populate_model_test_project_spine(model);

	// Load and run engine
	ROBOTICK_INFO("test-project-spine - loading engine...");
	robotick::Engine engine;
	engine.load(model);

	ROBOTICK_INFO("test-project-spine - running engine...");
	robotick::AtomicFlag dummy_flag{false};
	engine.run(dummy_flag);

	ROBOTICK_INFO("test-project-spine - exited engine...");
	vTaskDelete(nullptr);
}

ROBOTICK_ENTRYPOINT
{
	ROBOTICK_INFO("Starting Robotick engine on 'esp32' for model 'test-project-spine'...");

	BaseType_t result = xTaskCreatePinnedToCore(
		run_engine_on_core1,
		ENGINE_TASK_NAME,
		ENGINE_STACK_SIZE,
		nullptr,
		ENGINE_TASK_PRIORITY,
		nullptr,
		ENGINE_CORE_ID
	);

	if (result != pdPASS)
	{
		ROBOTICK_FATAL_EXIT("Failed to create engine task (error code %d)", static_cast<int>(result));
	}
}
