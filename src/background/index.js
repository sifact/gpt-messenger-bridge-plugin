// Background service worker for Meta Suite ChatGPT Bridge
import { handleGetAnswerFromChatGPT } from "./handlers.js";
import { handleOpenConversationAndRespond } from "./handlers.js";
import { notifyContentScriptsSettingsUpdated } from "./utils.js";
import { resolverStore } from "./state.js";
import { clearResolverStore } from "./chatgptService.js";

console.log("Background service worker started.");

// Global state for ChatGPT response handling

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background: Message received", request);

  if (request.action === "getAnswerFromChatGPT") {
    handleGetAnswerFromChatGPT(request, sendResponse);
    return true; // Indicates an asynchronous response.
  } else if (request.action === "openConversationAndRespond") {
    handleOpenConversationAndRespond(request, sender, sendResponse);
    return true; // Indicates an asynchronous response.
  } else if (request.action === "getSettings") {
    chrome.storage.sync.get(["isEnabled", "isPartialAutomation"], (settings) => {
      if (chrome.runtime.lastError) {
        console.error("Background: Error getting settings:", chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        // Set default values if settings are undefined
        if (settings.isEnabled === undefined) {
          console.log("Background: isEnabled setting not found, using default value: false");
          settings.isEnabled = false;
        }

        if (settings.isPartialAutomation === undefined) {
          console.log("Background: isPartialAutomation setting not found, using default value: false");
          settings.isPartialAutomation = false;
        }

        // We no longer use a static prefix - the customer name will be dynamically added in content.js
        settings.customResponsePrefix = "";

        console.log("Background: Returning settings:", settings);
        sendResponse(settings);
      }
    });
    return true;
  } else if (request.action === "saveSettings") {
    // Save both isEnabled and isPartialAutomation settings
    console.log("Background: Saving settings received from popup:", request.settings);
    chrome.storage.sync.set(
      {
        isEnabled: request.settings.isEnabled === true,
        isPartialAutomation: request.settings.isPartialAutomation === true,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Background: Error saving settings:", chrome.runtime.lastError.message);
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          console.log("Background: Settings successfully saved:", request.settings);
          // Verify what was actually saved
          chrome.storage.sync.get(["isEnabled", "isPartialAutomation"], (verifySettings) => {
            console.log("Background: Verification - settings after save:", verifySettings);
          });
          sendResponse({ status: "Settings saved" });
          notifyContentScriptsSettingsUpdated();
        }
      }
    );
    return true;
  } else if (request.action === "chatGPTResponse") {
    // Message from chatgpt-interactor.js
    console.log("Background: Received response from ChatGPT Interactor:", request.answer || request.error);
    // We need a way to correlate this response to the original request.
    // This requires a more robust callback/promise management system if multiple requests can be in flight.
    // For simplicity, assuming one request at a time for now.
    if (resolverStore.activeChatGPTResolver) {
      if (request.answer) {
        resolverStore.activeChatGPTResolver.resolve(request.answer);
      } else {
        resolverStore.activeChatGPTResolver.reject(request.error || "Unknown error from ChatGPT interactor");
      }

      // Clear the resolver store
      clearResolverStore();
      console.log("Background: Cleared resolver store after processing response");
    } else {
      console.warn("Background: Received chatGPTResponse but no active resolver found. This may indicate a race condition.");
      // Clear the resolver store anyway to ensure it's in a clean state
      clearResolverStore();
    }

    sendResponse({ status: "Response noted by background" }); // Acknowledge message
    return true;
  }
});

// Initialize settings if not already set
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.sync.set({
      isEnabled: false, // Changed: Default to disabled as requested
      isPartialAutomation: false, // Default to full automation
    });
    console.log("Background: Default settings saved on install - isEnabled: false");
    console.log("Meta Suite ChatGPT Bridge installed. Default settings saved. Automation is OFF by default.");
  } else if (details.reason === "update") {
    console.log("Meta Suite ChatGPT Bridge updated to version " + chrome.runtime.getManifest().version);
  }
});

// Export for Vite bundling
export {};
