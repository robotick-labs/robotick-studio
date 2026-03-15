// Auto-generated {{filename}}

#include "robotick/framework/CommonMain.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "robotick/framework/services/NetworkManager.h"

// Declare generated model function (no need for full header)
void populate_model_{{model_name_safe}}(robotick::Model& model);

// Run the engine on its own FreeRTOS task so the generated app_main stays minimal and
// model startup/teardown remains consistent across ESP32 models.
// Constants for engine task configuration
static constexpr const char* ENGINE_TASK_NAME = "robotick_main";
// Telemetry layout generation, Wi-Fi, REC, and display workloads can all be
// live at once on CoreS3-class targets, so keep generous headroom here.
static constexpr uint32_t ENGINE_STACK_SIZE = 32768; // in bytes
static constexpr UBaseType_t ENGINE_TASK_PRIORITY = 5;
static constexpr BaseType_t ENGINE_CORE_ID = 1;
static constexpr uint32_t NETWORK_CONNECT_RETRY_COUNT = 6;
static constexpr uint32_t NETWORK_CONNECT_RETRY_DELAY_MS = 2000;

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

{% if network and network.role == "hotspot_client" %}
	robotick::NetworkClientConfig network_cfg;
	network_cfg.ssid = "{{ network.ssid }}";
	network_cfg.password = "{{ network.password }}";
	network_cfg.static_ipv4 = "{{ network.client_static_ipv4 }}";
	network_cfg.gateway_ipv4 = "{{ network.client_gateway_ipv4 }}";
	network_cfg.netmask_ipv4 = "{{ network.client_netmask_ipv4 }}";
	bool connected = false;
	for (uint32_t attempt = 1; attempt <= NETWORK_CONNECT_RETRY_COUNT; ++attempt)
	{
		if (robotick::NetworkClient::connect(network_cfg))
		{
			connected = true;
			break;
		}

		if (attempt < NETWORK_CONNECT_RETRY_COUNT)
		{
			ROBOTICK_WARNING(
				"Failed to join robot hotspot '%s' on attempt %lu/%lu; retrying in %lu ms",
				network_cfg.ssid.c_str(),
				static_cast<unsigned long>(attempt),
				static_cast<unsigned long>(NETWORK_CONNECT_RETRY_COUNT),
				static_cast<unsigned long>(NETWORK_CONNECT_RETRY_DELAY_MS));
			vTaskDelay(pdMS_TO_TICKS(NETWORK_CONNECT_RETRY_DELAY_MS));
		}
	}

	if (!connected)
	{
		ROBOTICK_FATAL_EXIT(
			"Failed to join robot hotspot '%s' after %lu attempts",
			network_cfg.ssid.c_str(),
			static_cast<unsigned long>(NETWORK_CONNECT_RETRY_COUNT));
	}
{% endif %}
}

void run_engine_on_core1(void* param)
{
	initialize_network_runtime();

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
	vTaskDelete(nullptr);
}

ROBOTICK_ENTRYPOINT
{
	ROBOTICK_INFO("Starting Robotick engine on 'esp32' for model '{{ model_name }}'...");

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
