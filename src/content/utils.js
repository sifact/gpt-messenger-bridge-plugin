import { runAutomationCycle, setIsPartialChecking } from "./automation.js";
import { processedMessageStore } from "./messageExtractor.js";
import { deliveryAttempts } from "./state.js";

const NEXT_BUTTON_STYLES = `
  position: fixed;
  bottom: 60px;
  right: 60px;
  background-color: #0084ff;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  z-index: 9999;
  box-shadow: 0px 2px 5px rgba(0, 0, 0, 0.2);
`;

function clearProcessedConversationCache() {
  console.log(`Content.js: Clearing visual markers from processed conversations`);

  // Remove visual markers from conversations that might have been stuck
  const pendingElements = document.querySelectorAll(".chatgpt-pending-response");
  pendingElements.forEach((el) => {
    console.log(`Content.js: Clearing visual pending marker from element:`, el.getAttribute("data-chatgpt-conversation-id"));
    el.classList.remove("chatgpt-pending-response");
  });
}

function waitForElementOnPage(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const intervalTime = 100;
    let elapsedTime = 0;
    const interval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(interval);
        resolve(element);
      }
      elapsedTime += intervalTime;
      if (elapsedTime >= timeout) {
        clearInterval(interval);
        console.warn(`Content.js: waitForElementOnPage timed out for selector: ${selector}`);
        resolve(null);
      }
    }, intervalTime);
  });
}

// Function to remove the Next button
function removeNextButton() {
  const nextButton = document.getElementById("meta-suite-next-button");
  if (nextButton) {
    nextButton.remove();
  }
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
    setIsPartialChecking(true);
    console.log("Content.js: Next button clicked. Set isPartialChecking to true.");

    // Clear processed conversations cache to allow re-checking all conversations
    clearProcessedConversationCache();

    // Clear any pending delivery to ensure fresh scanning
    if (deliveryAttempts.currentResponseToDeliver) {
      deliveryAttempts.currentResponseToDeliver = null;
    }
    deliveryAttempts.isAttemptingDelivery = false;

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

export { waitForElementOnPage, NEXT_BUTTON_STYLES, addNextButton, removeNextButton, clearProcessedConversationCache };

export function addProcessedMessage(deliveryJob) {
  const messageKey = `${deliveryJob.conversationId}:${deliveryJob.originalQuestionText?.trim()?.slice(0, 50)}`;
  processedMessageStore.processedMessages.add(messageKey);
}
