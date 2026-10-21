# ResolveLink Ableton Live Native Extension
# Builds: resolvelink_ableton.dll (Windows), resolvelink_ableton.dylib (macOS), resolvelink_ableton.so (Linux)
# Requires: Ableton Extension SDK (https://www.ableton.com/en/live/extensions/)

cmake_minimum_required(VERSION 3.16)
project(ResolveLinkAbleton LANGUAGES C CXX)

# Version
set(RESOLVELINK_VERSION_MAJOR 1)
set(RESOLVELINK_VERSION_MINOR 1)
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
    set(TARGET_NAME "resolvelink_ableton")
elseif(APPLE)
    set(CMAKE_SHARED_LIBRARY_PREFIX "")
    set(CMAKE_SHARED_LIBRARY_SUFFIX ".dylib")
    set(TARGET_NAME "resolvelink_ableton")
else()
    set(CMAKE_SHARED_LIBRARY_PREFIX "lib")
    set(CMAKE_SHARED_LIBRARY_SUFFIX ".so")
    set(TARGET_NAME "resolvelink_ableton")
endif()

# Ableton Extension SDK path - can be overridden via -DABLETON_SDK_PATH=...
if(NOT DEFINED ENV{ABLETON_SDK_PATH} AND NOT ABLETON_SDK_PATH)
    if(WIN32)
        set(ABLETON_SDK_PATH "C:/Ableton/SDK" CACHE PATH "Path to Ableton Extension SDK")
    elseif(APPLE)
        set(ABLETON_SDK_PATH "/Applications/Ableton Live.app/Contents/Resources/SDK" CACHE PATH "Path to Ableton Extension SDK")
    else()
        set(ABLETON_SDK_PATH "/usr/local/include/ableton" CACHE PATH "Path to Ableton Extension SDK")
    endif()
endif()

# Find Ableton SDK
find_path(ABLETON_INCLUDE_DIR "Ableton.h"
    PATHS ${ABLETON_SDK_PATH}
    PATH_SUFFIXES "include" ""
    NO_DEFAULT_PATH
)

if(NOT ABLETON_INCLUDE_DIR)
    message(FATAL_ERROR "Ableton Extension SDK not found. Set ABLETON_SDK_PATH or install SDK at default location.")
endif()

message(STATUS "Ableton SDK found at: ${ABLETON_INCLUDE_DIR}")

# Platform-specific compile definitions
if(WIN32)
    add_compile_definitions(
        _WINDOWS
        _USRDLL
        RESOLVELINK_ABLETON_EXPORTS
        _CRT_SECURE_NO_WARNINGS
        NOMINMAX
    )
    # Link against required Windows libraries
    set(PLATFORM_LIBS ws2_32 version)
elseif(APPLE)
    add_compile_definitions(
        MAC_OS_X
        __MACOSX_CORE__
    )
    set(PLATFORM_LIBS "-framework CoreFoundation -framework CoreAudio -framework AudioToolbox -framework AppKit")
else()
    add_compile_definitions(
        LINUX
        _GNU_SOURCE
    )
    set(PLATFORM_LIBS dl pthread rt)
endif()

# Common definitions
add_compile_definitions(
    ABLETON_API_VERSION=20240101
    RESOLVELINK_VERSION_MAJOR=${RESOLVELINK_VERSION_MAJOR}
    RESOLVELINK_VERSION_MINOR=${RESOLVELINK_VERSION_MINOR}
    RESOLVELINK_VERSION_PATCH=${RESOLVELINK_VERSION_PATCH}
)

# Include directories
include_directories(${ABLETON_INCLUDE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/include)

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
    target_link_options(${TARGET_NAME} PRIVATE /DLL /EXPORT:ABLETON_ENTRY_POINT)
elseif(APPLE)
    target_link_options(${TARGET_NAME} PRIVATE -undefined dynamic_lookup)
else()
    target_link_options(${TARGET_NAME} PRIVATE -shared -fPIC)
endif()

# Install targets
install(TARGETS ${TARGET_NAME}
    LIBRARY DESTINATION "Extensions/ResolveLink"
    RUNTIME DESTINATION "Extensions/ResolveLink"
)

# Development install (copy to Ableton UserPlugins for testing)
if(DEFINED ENV{ABLETON_USER_EXTENSIONS_DIR})
    add_custom_command(TARGET ${TARGET_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:${TARGET_NAME}>
            $ENV{ABLETON_USER_EXTENSIONS_DIR}/ResolveLink/
        COMMENT "Installing to Ableton UserExtensions for testing"
    )
endif()

# Testing
enable_testing()
add_test(NAME ResolveLink_Load COMMAND $<TARGET_FILE:${TARGET_NAME}> --test-load)

# Packaging
set(CPACK_PACKAGE_NAME "ResolveLink-Ableton")
set(CPACK_PACKAGE_VERSION ${RESOLVELINK_VERSION})
set(CPACK_GENERATOR "ZIP")
include(CPack)