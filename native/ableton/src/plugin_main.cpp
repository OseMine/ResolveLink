/**
 * ResolveLink Ableton Live Native Extension - Main Entry Point
 * 
 * Entry point for the Ableton Extension SDK.
 * Provides high-performance IPC, real-time clip management,
 * transport control, device automation, and stem export.
 */

#include "AbletonExtension.h"
#include "ExtensionImpl.h"
#include "IPCServer.h"
#include "LiveSetManager.h"
#include "TransportController.h"
#include "ClipManager.h"
#include "DeviceManager.h"
#include "Logger.h"

#include <memory>
#include <atomic>

namespace resolvelink {

// Global extension instance
static std::unique_ptr<ExtensionImpl> g_extension = nullptr;
static std::atomic<bool> g_isLoaded = false;

// ─────────────────────────────────────────────────────────────────
// Extension Entry Points
// ─────────────────────────────────────────────────────────────────

extern "C" ABLETON_EXTENSION_EXPORT bool AbletonExtensionEntry(
    Ableton::Extension::IHost* host,
    Ableton::Extension::IExtension** outExtension
) {
    try {
        if (g_isLoaded.load()) {
            return false; // Already loaded
        }
        
        if (!host) {
            return false;
        }
        
        // Create extension instance
        g_extension = std::make_unique<ExtensionImpl>(host);
        
        if (!g_extension->initialize()) {
            g_extension.reset();
            return false;
        }
        
        *outExtension = g_extension.get();
        g_isLoaded.store(true);
        
        Logger::info("ResolveLink Ableton Extension loaded successfully");
        return true;
        
    } catch (const std::exception& e) {
        Logger::error(std::string("Failed to load extension: ") + e.what());
        return false;
    }
}

extern "C" ABLETON_EXTENSION_EXPORT void AbletonExtensionExit(
    Ableton::Extension::IExtension* extension
) {
    if (g_extension) {
        g_extension->shutdown();
        g_extension.reset();
        g_isLoaded.store(false);
        Logger::info("ResolveLink Ableton Extension unloaded");
    }
}

extern "C" ABLETON_EXTENSION_EXPORT const char* AbletonExtensionGetVersion() {
    return RESOLVELINK_VERSION_STRING;
}

extern "C" ABLETON_EXTENSION_EXPORT const char* AbletonExtensionGetName() {
    return "ResolveLink";
}

extern "C" ABLETON_EXTENSION_EXPORT const char* AbletonExtensionGetDescription() {
    return "ResolveLink Ableton Live Native Extension - High-performance IPC, real-time clip management, transport control, and device automation";
}

} // namespace resolvelink