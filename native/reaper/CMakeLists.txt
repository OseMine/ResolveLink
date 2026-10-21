# ResolveLink REAPER Native Extension
# Builds: resolvelink.dll (Windows), resolvelink.dylib (macOS), resolvelink.so (Linux)
# Requires: REAPER SDK (https://www.reaper.fm/sdk/plugin/plugin.php#ext_dl)

cmake_minimum_required(VERSION 3.16)
project(ResolveLinkReaper LANGUAGES C CXX)

# Version
set(RESOLVELINK_VERSION_MAJOR 1)
set(RESOLVELINK_VERSION_MINOR 0)
set(RESOLVELINK_VERSION_PATCH 0)
set(RESOLVELINK_VERSION "${RESOLVELINK_VERSION_MAJOR}.${RESOLVELINK_VERSION_MINOR}.${RESOLVELINK_VERSION_PATCH}")

# C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Platform-specific output naming
if(WIN32)
    set(CMAKE_SHARED_LIBRARY_PREFIX "")
    set(CMAKE_SHARED_LIBRARY_SUFFIX ".dll")
    set(TARGET_NAME "resolvelink")
elseif(APPLE)
    set(CMAKE_SHARED_LIBRARY_PREFIX "")
    set(CMAKE_SHARED_LIBRARY_SUFFIX ".dylib")
    set(TARGET_NAME "resolvelink")
else()
    set(CMAKE_SHARED_LIBRARY_PREFIX "lib")
    set(CMAKE_SHARED_LIBRARY_SUFFIX ".so")
    set(TARGET_NAME "resolvelink")
endif()

# REAPER SDK path - can be overridden via -DREAPER_SDK_PATH=...
if(NOT DEFINED ENV{REAPER_SDK_PATH} AND NOT REAPER_SDK_PATH)
    if(WIN32)
        set(REAPER_SDK_PATH "C:/REAPER-SDK" CACHE PATH "Path to REAPER SDK")
    elseif(APPLE)
        set(REAPER_SDK_PATH "/Applications/REAPER.app/Contents/Resources/SDK" CACHE PATH "Path to REAPER SDK")
    else()
        set(REAPER_SDK_PATH "/usr/local/include/reaper" CACHE PATH "Path to REAPER SDK")
    endif()
endif()

# Find REAPER SDK
find_path(REAPER_INCLUDE_DIR "reaper_plugin.h"
    PATHS ${REAPER_SDK_PATH}
    PATH_SUFFIXES ""
    NO_DEFAULT_PATH
)

if(NOT REAPER_INCLUDE_DIR)
    message(FATAL_ERROR "REAPER SDK not found. Set REAPER_SDK_PATH or install SDK at default location.")
endif()

message(STATUS "REAPER SDK found at: ${REAPER_INCLUDE_DIR}")

# Platform-specific compile definitions
if(WIN32)
    add_compile_definitions(
        _WINDOWS
        _USRDLL
        RESOLVELINK_EXPORTS
        _CRT_SECURE_NO_WARNINGS
        NOMINMAX
    )
    # Link against required Windows libraries
    set(PLATFORM_LIBS ws2_32 winhttp version shell32)
elseif(APPLE)
    add_compile_definitions(
        MAC_OS_X
        __MACOSX_CORE__
    )
    # Try to find libcurl
    find_package(CURL QUIET)
    if(CURL_FOUND)
        add_compile_definitions(HAVE_CURL)
        set(PLATFORM_LIBS "${CURL_LIBRARIES} -framework CoreFoundation -framework CoreAudio -framework AudioToolbox")
    else()
        set(PLATFORM_LIBS "-framework CoreFoundation -framework CoreAudio -framework AudioToolbox")
    endif()
else()
    add_compile_definitions(
        LINUX
        _GNU_SOURCE
    )
    # Try to find libcurl
    find_package(CURL QUIET)
    if(CURL_FOUND)
        add_compile_definitions(HAVE_CURL)
        set(PLATFORM_LIBS ${CURL_LIBRARIES} dl pthread rt)
    else()
        set(PLATFORM_LIBS dl pthread rt)
    endif()
endif()

# Common definitions
add_compile_definitions(
    REAPER_PLUGIN_VERSION=0x00060000
)

# Include directories
include_directories(${REAPER_INCLUDE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/include)

# Source files
file(GLOB_RECURSE SOURCES "src/*.cpp" "src/*.c")

# Create shared library
add_library(${TARGET_NAME} SHARED ${SOURCES})

# Set output directory
set_target_properties(${TARGET_NAME} PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    VERSION ${RESOLVELINK_VERSION}
    SOVERSION ${RESOLVELINK_VERSION_MAJOR}
)

# Link libraries
target_link_libraries(${TARGET_NAME} PRIVATE ${PLATFORM_LIBS})

# Platform-specific linker flags
if(WIN32)
    target_link_options(${TARGET_NAME} PRIVATE /DLL /EXPORT:REAPER_PLUGIN_ENTRYPOINT)
elseif(APPLE)
    target_link_options(${TARGET_NAME} PRIVATE -undefined dynamic_lookup)
else()
    target_link_options(${TARGET_NAME} PRIVATE -shared -fPIC)
endif()

# Install targets
install(TARGETS ${TARGET_NAME}
    LIBRARY DESTINATION "Plugins/ResolveLink"
    RUNTIME DESTINATION "Plugins/ResolveLink"
)

# Development install (copy to REAPER UserPlugins for testing)
if(DEFINED ENV{REAPER_USER_PLUGINS_DIR})
    add_custom_command(TARGET ${TARGET_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:${TARGET_NAME}>
            $ENV{REAPER_USER_PLUGINS_DIR}/ResolveLink/
        COMMENT "Installing to REAPER UserPlugins for testing"
    )
endif()

# Testing
enable_testing()
add_test(NAME ResolveLink_Load COMMAND $<TARGET_FILE:${TARGET_NAME}> --test-load)

# Packaging
set(CPACK_PACKAGE_NAME "ResolveLink-REAPER")
set(CPACK_PACKAGE_VERSION ${RESOLVELINK_VERSION})
set(CPACK_GENERATOR "ZIP")
include(CPack)