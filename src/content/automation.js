// Functions for handling automation of the content script

import { extractQuestions } from "./messageExtractor.js";
import { notFoundMessages, deliveryAttempts } from "./state.js";
import { sendQuestionsToBackground, initiateResponseDeliverySequence } from "./messageHandler.js";
import { NEXT_BUTTON_STYLES, addNextButton, clearProcessedConversationCache } from "./utils.js";

// Constants

const POLLING_INTERVAL = 5000; // 5 seconds

// State variables
let mainIntervalId = null;
let isPartialChecking = true;

// Function to set isPartialChecking from other modules
function setIsPartialChecking(value) {
  isPartialChecking = value;
  console.log(`Content.js: isPartialChecking set to ${value}`);
}

// Function to get the current value of isPartialChecking
function getIsPartialChecking() {
  return isPartialChecking;
}

// Run a single automation cycle
async function runAutomationCycle() {
  // If a response is currently being delivered or is queued, pause the automation cycle.
  // if (currentResponseToDeliver) {
  //   console.log(
  //     `Content.js: Automation cycle paused. Waiting to deliver response for Conv ID: ${currentResponseToDeliver.conversationId} (Sender: ${currentResponseToDeliver.sender}, Original Q: "${currentResponseToDeliver.originalQuestionText}"). Not scanning for new messages now.`
  //   );
  //   return;
  // }
  if (deliveryAttempts.isAttemptingDelivery) {
    console.log(`Content.js: Automation cycle paused. A delivery attempt is already in progress (isAttemptingDelivery is true). Not scanning for new messages now.`);
    return;
  }

  const settings = await chrome.runtime.sendMessage({ action: "getSettings" });
  if (chrome.runtime.lastError) {
    console.error("Content.js: Error getting settings in runAutomationCycle:", chrome.runtime.lastError.message);
    return;
  }

  // Store isPartialAutomation in global state so it can be accessed by initiateResponseDeliverySequence
  window.isPartialAutomationEnabled = settings.isPartialAutomation === true;
  if (window.isPartialAutomationEnabled) {
    console.log("Content.js: Partial Automation mode enabled. Responses will be placed in input box but not sent automatically.");
  }

  // Check if we should skip scanning conversations - only apply isPartialChecking when partial automation is enabled
  if (window.isPartialAutomationEnabled && !isPartialChecking) {
    console.log("Content.js: Skipping conversation scanning because isPartialChecking is false while in Partial Automation mode.");
    return;
  } else if (!window.isPartialAutomationEnabled) {
    // When partial automation is disabled, always scan conversations regardless of isPartialChecking
    // This ensures isPartialChecking only affects behavior when partial automation is enabled
    isPartialChecking = true; // Reset this to default state when partial automation is off
  }

  // Double-check that we don't have a response being delivered
  // This is a critical safeguard to prevent multiple triggers
  if (deliveryAttempts.currentResponseToDeliver) {
    console.log("Content.js: Automation cycle paused. A response is already staged for delivery.");
    return;
  }

  // Check if there are any conversations with the chatgpt-pending-response class
  // This indicates that a request is already in progress
  const pendingElements = document.querySelectorAll(".chatgpt-pending-response");
  if (pendingElements.length > 0) {
    console.log(`Content.js: Automation cycle paused. There are ${pendingElements.length} conversations with pending responses.`);
    return;
  }

  if (settings && settings.isEnabled) {
    const questions = extractQuestions();
    if (questions.length > 0) {
      await sendQuestionsToBackground(questions);
    } else {
      // console.log("Content.js: No new unread questions found during this cycle with new logic.");
      if (notFoundMessages.size > 0) {
        // console.log(
        //   `Content.js: No unread messages found. Clearing the 'NOTFOUND' cache which had ${notFoundMessages.size} items. Cache content before clear:`,
        //   Array.from(notFoundMessages)
        // );
        // notFoundMessages.clear();
        // processedConversations Map has been removed
      }
    }
  } else {
    // console.log("Content.js: Automation is disabled via settings.");
  }
}

// Start the automation process
function startAutomation() {
  console.log("Content.js: Attempting to start automation with new logic...");

  if (mainIntervalId) {
    clearInterval(mainIntervalId);
    mainIntervalId = null;
  }

  isPartialChecking = true;
  console.log("Content.js: Reset isPartialChecking to true during automation start.");

  // Clear the processed conversations cache on startup
  clearProcessedConversationCache();

  // Add the "Next" button to the page
  addNextButton();

  runAutomationCycle(); // Initial run

  // Always start the polling interval
  mainIntervalId = setInterval(runAutomationCycle, POLLING_INTERVAL);
  console.log(`Content.js: Polling interval started with ID ${mainIntervalId} for every ${POLLING_INTERVAL}ms.`);

  // Removed MutationObserver as we only want to rely on the polling interval
  console.log("Content.js: Relying solely on polling interval for message scanning.");
}

// Stop the automation process
function stopAutomation() {
  console.log("Content.js: Stopping automation.");
  // Removed stopMutationObserver call - we no longer use MutationObserver
  if (mainIntervalId) {
    clearInterval(mainIntervalId);
    console.log(`Content.js: Polling interval ${mainIntervalId} stopped.`);
    mainIntervalId = null;
  }
  // Reset delivery state when stopping automation
  deliveryAttempts.currentResponseToDeliver = null;
  deliveryAttempts.isAttemptingDelivery = false;
}

// Remove the "Next" button from the page
function removeNextButton() {
  const nextButton = document.getElementById("meta-suite-next-button");
  if (nextButton) {
    nextButton.remove();
    console.log("Content.js: Removed Next button from the page");
  }
}

// Add this function to clear the current response
function clearCurrentResponse() {
  if (deliveryAttempts.currentResponseToDeliver) {
    console.log(`Content.js: Clearing current response delivery for ${currentResponseToDeliver.conversationId} to allow fresh scanning.`);
    deliveryAttempts.currentResponseToDeliver = null;
  }
  deliveryAttempts.isAttemptingDelivery = false;
}

export { runAutomationCycle, startAutomation, stopAutomation, setIsPartialChecking, getIsPartialChecking, clearCurrentResponse, removeNextButton };
