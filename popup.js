// popup.js
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM LOADED - Popup Initialized");

  const enableAutomationCheckbox = document.getElementById("enableAutomation");
  console.log("enableAutomationCheckbox found:", enableAutomationCheckbox);

  const enablePartialAutomationCheckbox = document.getElementById("enablePartialAutomation");
  console.log("enablePartialAutomationCheckbox found:", enablePartialAutomationCheckbox);

  const statusMessage = document.getElementById("statusMessage");
  const activityLogDiv = document.getElementById("activityLog");

  // --- Activity Log Helper Function ---
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

  // Initial log message
  updateActivityLog("Popup opened. Settings are being loaded.");

  // Check if elements were found
  if (!enableAutomationCheckbox) {
    console.error("CRITICAL ERROR: enableAutomationCheckbox element not found!");
    updateActivityLog("Error: Main automation toggle not found", "error");
  }

  if (!enablePartialAutomationCheckbox) {
    console.error("CRITICAL ERROR: enablePartialAutomationCheckbox element not found!");
    updateActivityLog("Error: Partial automation toggle not found", "error");
  }

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
      console.log("Popup: Settings loaded", response);
      console.log("Popup: isEnabled =", response.isEnabled, "isPartialAutomation =", response.isPartialAutomation);

      if (enableAutomationCheckbox) {
        enableAutomationCheckbox.checked = response.isEnabled === true;
        console.log("Set enableAutomationCheckbox.checked to", enableAutomationCheckbox.checked);
      }

      if (enablePartialAutomationCheckbox) {
        enablePartialAutomationCheckbox.checked = response.isPartialAutomation === true;
        console.log("Set enablePartialAutomationCheckbox.checked to", enablePartialAutomationCheckbox.checked);
      }
    } else {
      console.warn("Popup: No response or empty settings received.");
      statusMessage.textContent = "Could not load settings.";
      statusMessage.className = "error";
    }
  });

  // --- Save settings automatically when main checkbox is clicked ---
  if (enableAutomationCheckbox) {
    enableAutomationCheckbox.addEventListener("change", () => {
      const newValue = enableAutomationCheckbox.checked;
      console.log("Popup: Toggle changed to:", newValue);
      statusMessage.textContent = newValue ? "Enabling automation..." : "Disabling automation...";
      statusMessage.className = "";

      const newSettings = {
        isEnabled: newValue,
        isPartialAutomation: enablePartialAutomationCheckbox ? enablePartialAutomationCheckbox.checked : false,
      };

      // Debug log
      console.log("Popup: Saving new settings:", newSettings);

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
  }

  // --- Save settings when partial automation checkbox is clicked ---
  if (enablePartialAutomationCheckbox) {
    enablePartialAutomationCheckbox.addEventListener("change", () => {
      const newValue = enablePartialAutomationCheckbox.checked;
      console.log("Popup: Partial automation toggle changed to:", newValue);
      statusMessage.textContent = newValue ? "Enabling partial automation..." : "Disabling partial automation...";
      statusMessage.className = "";

      const newSettings = {
        isEnabled: enableAutomationCheckbox ? enableAutomationCheckbox.checked : true,
        isPartialAutomation: newValue,
      };

      // Debug log
      console.log("Popup: Saving new partial automation settings:", newSettings);

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
          statusMessage.textContent = "Partial automation settings saved!";
          statusMessage.className = "success";
          console.log("Popup: Partial automation settings saved successfully.");
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
  } else {
    console.error("Cannot add event listener - enablePartialAutomationCheckbox is null");
  }
});
