// popup.js
document.addEventListener("DOMContentLoaded", () => {
  const enableAutomationCheckbox = document.getElementById("enableAutomation");
  const customPrefixInput = document.getElementById("customPrefix");
  const saveSettingsButton = document.getElementById("saveSettings");
  const statusMessage = document.getElementById("statusMessage");
  const activityLogDiv = document.getElementById("activityLog");

  // --- Load current settings ---
  chrome.runtime.sendMessage({ action: "getSettings" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Popup: Error getting settings:", chrome.runtime.lastError.message);
      statusMessage.textContent = "Error loading settings: " + chrome.runtime.lastError.message;
      statusMessage.className = "error";
      return;
    }
    if (response && response.error) {
      console.error("Popup: Error from background getting settings:", response.error);
      statusMessage.textContent = "Error loading settings: " + response.error;
      statusMessage.className = "error";
    } else if (response) {
      enableAutomationCheckbox.checked = !!response.isEnabled;
      customPrefixInput.value = response.customResponsePrefix || "";
      console.log("Popup: Settings loaded", response);
    } else {
      console.warn("Popup: No response or empty settings received.");
      statusMessage.textContent = "Could not load settings.";
      statusMessage.className = "error";
    }
  });

  // --- Save settings ---
  saveSettingsButton.addEventListener("click", () => {
    statusMessage.textContent = "Saving...";
    statusMessage.className = "";

    const newSettings = {
      isEnabled: enableAutomationCheckbox.checked,
      customResponsePrefix: customPrefixInput.value.trim(),
    };

    chrome.runtime.sendMessage({ action: "saveSettings", settings: newSettings }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Popup: Error sending saveSettings message:", chrome.runtime.lastError.message);
        statusMessage.textContent = "Error saving: " + chrome.runtime.lastError.message;
        statusMessage.className = "error";
      } else if (response && response.error) {
        console.error("Popup: Error from background saving settings:", response.error);
        statusMessage.textContent = "Error saving: " + response.error;
        statusMessage.className = "error";
      } else if (response && response.status === "Settings saved") {
        statusMessage.textContent = "Settings saved successfully!";
        statusMessage.className = "success";
        console.log("Popup: Settings saved successfully.");
        // The background script will notify content scripts.
      } else {
        statusMessage.textContent = "Failed to save settings. Unknown response.";
        statusMessage.className = "error";
        console.warn("Popup: Unknown response from saveSettings:", response);
      }
      setTimeout(() => {
        if (statusMessage.className !== "error") {
          // Don't clear error messages immediately
          statusMessage.textContent = "";
          statusMessage.className = "";
        }
      }, 3000);
    });
  });

  // --- Activity Log (Placeholder) ---
  // This would typically be populated by listening to messages from the background script.
  function updateActivityLog(message, type = "info") {
    if (activityLogDiv.firstChild && activityLogDiv.firstChild.textContent === "No activity yet.") {
      activityLogDiv.innerHTML = ""; // Clear initial message
    }
    const logEntry = document.createElement("p");
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logEntry.className = type; // e.g., 'log-info', 'log-error'
    activityLogDiv.prepend(logEntry); // Add new logs to the top

    // Limit log entries
    while (activityLogDiv.children.length > 20) {
      activityLogDiv.removeChild(activityLogDiv.lastChild);
    }
  }

  // Example of listening for log messages from background.js
  // chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  //   if (request.action === "logToPopup" && request.message) {
  //     updateActivityLog(request.message, request.type || "info");
  //     sendResponse({status: "Log received by popup"});
  //   }
  //   return true; // Keep channel open for other messages if any
  // });

  // Initial log message
  updateActivityLog("Popup opened. Settings are being loaded.");
});
