// Utility functions for the background script

// Function to forward inject command to content script
function forwardInjectCommandToContentScript(conversationId, answer) {
  chrome.runtime.sendMessage({ action: "injectResponse", conversationId: conversationId, answer: answer }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("Background (via executeScript): Error sending injectResponse to content script:", chrome.runtime.lastError.message);
    } else {
      console.log("Background (via executeScript): injectResponse message sent to content script, response:", response);
    }
  });
}

function notifyContentScriptsSettingsUpdated() {
  chrome.tabs.query({ url: ["https://business.facebook.com/latest/inbox/*", "https://*.meta.com/business/inbox/*"] }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { action: "settingsUpdated" }, (response) => {
        if (chrome.runtime.lastError) {
          // console.log(`Background: Could not send settings update to tab ${tab.id}: ${chrome.runtime.lastError.message}`);
        } else {
          // console.log(`Background: Settings update notification sent to tab ${tab.id}`);
        }
      });
    });
  });
}

export { forwardInjectCommandToContentScript, notifyContentScriptsSettingsUpdated };
