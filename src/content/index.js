// Content script for Meta Suite ChatGPT Bridge

import { startAutomation, stopAutomation, runAutomationCycle, clearCurrentResponse } from "./automation.js";

console.log("Meta Suite ChatGPT Bridge content script loaded.");

// Initialize settings and automation
let isEnabled = false;
let isPartialAutomation = false;

// Function to initialize the content script
async function initializeAutomation() {
  const settings = await chrome.runtime.sendMessage({ action: "getSettings" });
  if (chrome.runtime.lastError) {
    console.error("Content.js: Error getting settings for initial automation setup:", chrome.runtime.lastError.message);
    return;
  }
  if (settings && settings.isEnabled) {
    startAutomation();
  } else {
    console.log("Content.js: Initial settings indicate automation is disabled.");
  }
}

// Initialize when the page is loaded

// Also initialize immediately in case DOMContentLoaded already fired
initializeAutomation();

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "sync" && changes.isEnabled !== undefined) {
    console.log("Content.js: isEnabled setting changed to", changes.isEnabled.newValue);
    if (changes.isEnabled.newValue) {
      startAutomation();
    } else {
      stopAutomation();
    }
  }
});

// Listen for messages from background script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // The 'injectResponse' action is now handled internally by initiateResponseDeliverySequence,
  // triggered when 'sendQuestionsToBackground' receives an answer.
  // So, the 'injectResponse' message from background might be deprecated or used for other purposes if needed.
  // For now, we'll keep a simple handler for 'settingsUpdated'.

  if (request.action === "settingsUpdated") {
    console.log("Content.js: Notified of settings update. Re-evaluating automation cycle.");

    // When settings are updated, check if partial automation is disabled and reset isPartialChecking
    chrome.runtime.sendMessage({ action: "getSettings" }, (settings) => {
      if (!settings?.isPartialAutomation) {
        // When partial automation is off, always reset isPartialChecking to true
        isPartialChecking = true;
        console.log("Content.js: Partial automation disabled, reset isPartialChecking to true");
      }

      stopAutomation();
      initializeAutomation();
    });

    sendResponse({ status: "Settings acknowledged by content script" });
    return true;
  } else if (request.action === "injectResponse") {
    // Existing code...
  } else if (request.action === "clearCurrentResponse") {
    console.log("Content.js: Received clearCurrentResponse request");
    clearCurrentResponse();
    // Make sure we respond to the message
    sendResponse({ status: "Current response cleared" });
    return true;
  }
  console.log("Content.js: Received unhandled message action:", request.action);
  return false;
});

// Export for Vite bundling
export { isEnabled, isPartialAutomation };
