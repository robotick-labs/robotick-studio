# Auto-generated project CMakeLists.txt (linux) for model: 'test-project-brain'

cmake_minimum_required(VERSION 3.21)
project(test-project-brain-linux)
set(CMAKE_CXX_STANDARD 17)

# Define where we can find the engine:
set(ROBOTICK_ENGINE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../../../../robotick-engine" CACHE PATH "Path to engine root")

# Define platform macros
set(ROBOTICK_PLATFORM_DESKTOP ON CACHE BOOL "Enable platform macro")
add_compile_definitions(ROBOTICK_PLATFORM_DESKTOP=1)

set(ROBOTICK_PLATFORM_LINUX ON CACHE BOOL "Enable platform macro")
add_compile_definitions(ROBOTICK_PLATFORM_LINUX=1)

# Add the robotick-engine as a buildable subproject
add_subdirectory(${ROBOTICK_ENGINE_ROOT} ${CMAKE_BINARY_DIR}/robotick_engine)

# Define the main executable
add_executable(test-project-brain
    test_project_brain_model.cpp
    test_project_brain_main.cpp
)

# Enable symbol visibility for backtrace resolution
target_link_options(test-project-brain PRIVATE -rdynamic)

# Ensure debug symbols are preserved
set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "" FORCE)

# Create workload registry
add_library(workload_registry STATIC
    registry/generated_workload_registry.cpp
)

# Enforce strict compilation rules to help ensure code quality
target_compile_options(workload_registry PRIVATE -Wall -Wextra -Werror)
target_compile_options(test-project-brain PRIVATE -Wall -Wextra -Werror)

target_include_directories(workload_registry PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../workloads/cpp/include
)
target_include_directories(workload_registry PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../workloads/cpp/src
)

# Pull in aggregated deps (deduped from YAMLs)
set(ROBOTICK_MAIN_TARGET workload_registry)
set(ROBOTICK_EXECUTABLE_TARGET test-project-brain)
include("${CMAKE_CURRENT_SOURCE_DIR}/registry/generated_workload_deps.cmake")

# Link engine into workload registry
target_link_libraries(workload_registry PUBLIC robotick-engine)

# Link workload registry into main binary
target_link_libraries(test-project-brain PRIVATE workload_registry)