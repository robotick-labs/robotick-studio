# Auto-generated main-component CMakeLists.txt (esp32) for model: 'test-project-spine'

idf_component_register(
    SRCS
        test_project_spine_main.cpp
        test_project_spine_model.cpp
        registry/generated_workload_registry.cpp
    INCLUDE_DIRS
        .
        ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../../workloads/cpp/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../../workloads/cpp/src
    PRIV_REQUIRES 
        robotick-engine
        M5Unified
        M5GFX
)