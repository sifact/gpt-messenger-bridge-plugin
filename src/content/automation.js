// Functions for handling automation of the content script

import { extractQuestions, notFoundMessages } from "./messageExtractor.js";
import { sendQuestionsToBackground, initiateResponseDeliverySequence } from "./messageHandler.js";
import { NEXT_BUTTON_STYLES } from "./utils.js";

// Constants

const POLLING_INTERVAL = 5000; // 5 seconds

// State variables
let mainIntervalId = null;
let isPartialChecking = true;
let isAttemptingDelivery = false;
let currentResponseToDeliver = null;

// Run a single automation cycle
async function runAutomationCycle() {
  // If a response is currently being delivered or is queued, pause the automation cycle.
  if (currentResponseToDeliver) {
    console.log(
      `Content.js: Automation cycle paused. Waiting to deliver response for Conv ID: ${currentResponseToDeliver.conversationId} (Sender: ${currentResponseToDeliver.sender}, Original Q: "${currentResponseToDeliver.originalQuestionText}"). Not scanning for new messages now.`
    );
    return;
  }
  if (isAttemptingDelivery) {
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

  if (settings && settings.isEnabled) {
    // Pass notFoundMessages to extractQuestions for pre-filtering
    const questions = extractQuestions(notFoundMessages);
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

function clearProcessedConversationCache() {
  console.log(`Content.js: Clearing visual markers from processed conversations`);

  // Remove visual markers from conversations that might have been stuck
  const pendingElements = document.querySelectorAll(".chatgpt-pending-response");
  pendingElements.forEach((el) => {
    console.log(`Content.js: Clearing visual pending marker from element:`, el.getAttribute("data-chatgpt-conversation-id"));
    el.classList.remove("chatgpt-pending-response");
  });
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
  currentResponseToDeliver = null;
  isAttemptingDelivery = false;
}

// Add a "Next" button to the page for partial automation mode
function addNextButton() {
  // Remove existing button if it exists
  const existingButton = document.getElementById("meta-suite-next-button");
  if (existingButton) {
    existingButton.remove();
  }

  // Create the button
  const nextButton = document.createElement("button");
  nextButton.id = "meta-suite-next-button";
  nextButton.textContent = "Next";
  nextButton.style.cssText = NEXT_BUTTON_STYLES;

  // Add click event handler
  nextButton.addEventListener("click", () => {
    isPartialChecking = true;
    console.log("Content.js: Next button clicked. Set isPartialChecking to true.");

    // Clear processed conversations cache to allow re-checking all conversations
    clearProcessedConversationCache();

    // Clear any pending delivery to ensure fresh scanning
    if (currentResponseToDeliver) {
      console.log(`Content.js: Clearing current response delivery for ${currentResponseToDeliver.conversationId} to allow fresh scanning.`);
      currentResponseToDeliver = null;
    }
    isAttemptingDelivery = false;

    // Run automation cycle immediately to check for new messages
    setTimeout(runAutomationCycle, 500);

    // Visual feedback that the button was clicked
    nextButton.textContent = "Scanning...";
    setTimeout(() => {
      nextButton.textContent = "Next";
    }, 1500);
  });

  // Add the button to the page
  document.body.appendChild(nextButton);
  console.log("Content.js: Added 'Next' button to the page.");
}

// Remove the "Next" button from the page
function removeNextButton() {
  const nextButton = document.getElementById("chatgpt-next-button");
  if (nextButton) {
    nextButton.remove();
    console.log("Content.js: Removed Next button from the page");
  }
}

export { runAutomationCycle, startAutomation, stopAutomation, addNextButton };
