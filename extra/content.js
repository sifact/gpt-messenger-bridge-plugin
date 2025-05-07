// content.js
console.log("Meta Suite ChatGPT Bridge content script loaded (with new extraction logic).");

// --- Global State for Response Delivery ---
let currentResponseToDeliver = null; // { conversationId: string, answer: string, originalPreviewElement: HTMLElement, retries: number }
let isAttemptingDelivery = false; // Flag to prevent concurrent delivery attempts
const MAX_DELIVERY_RETRIES = 2; // Max times to try delivering a single response

// Function to extract customer questions based on the new selectors
function extractQuestions() {
  const questions = [];
  console.log("Content.js: Attempting to extract questions using new selectors.");

  // Selector for individual conversation containers from the provided file
  const conversationContainerSelector = "div._4k8w";
  const conversations = document.querySelectorAll(conversationContainerSelector);
  console.log(`Content.js: Found ${conversations.length} potential conversation containers using selector "${conversationContainerSelector}".`);

  conversations.forEach((conv, index) => {
    let senderName = "Unknown Sender";
    let messageText = "";
    let isUnread = false;
    // Attempt to get a conversation ID. This is crucial and needs a reliable source.
    // The provided script doesn't specify how it gets a unique ID for opening the chat.
    // We'll use a placeholder. A real ID (e.g., from a data-attribute) is needed.
    let conversationId = `new-convo-${index}-${Date.now()}`;

    try {
      // Get username element and check for unread status
      const usernameElement = conv.querySelector(".xmi5d70"); // Selector from provided file
      if (!usernameElement) {
        // console.log("Content.js: Username element not found for a conversation, skipping.");
        return; // Skip this conversation
      }
      senderName = usernameElement.textContent.trim();

      // Check unread status based on classes from the provided file
      // x117nqv4 indicates unread, x1fcty0u indicates read
      const isMarkedUnread = usernameElement.classList.contains("x117nqv4");
      const isMarkedRead = usernameElement.classList.contains("x1fcty0u");
      isUnread = isMarkedUnread && !isMarkedRead;

      if (!isUnread) {
        // console.log(`Content.js: Conversation with "${senderName}" is not marked as unread, skipping.`);
        return; // Skip if not unread
      }

      // Get message text
      const messageDiv = conv.querySelector("div._4k8y ._4ik4._4ik5"); // Selector from provided file
      if (!messageDiv) {
        // console.log(`Content.js: Message div not found for "${senderName}", skipping.`);
        return; // Skip if no message div
      }
      messageText = messageDiv.textContent.trim();

      // CRUCIAL CHANGE: Skip messages that start with "You:", process others.
      if (messageText.toLowerCase().startsWith("you:")) {
        console.log(`Content.js: Message from "${senderName}" starts with "You:", skipping as it's an outgoing message. Text: "${messageText}"`);
        return; // Skip our own messages
      }

      // Attempt to find a clickable element to get a more stable conversation ID if possible
      // The provided script uses "div._a6ag._a6ah" to click and open.
      // Often, such elements or their parents might have a data-conversation-id or similar.
      const clickableElement = conv.querySelector("div._a6ag._a6ah"); // Example from your file
      if (clickableElement) {
        // Try to find a data-testid or data-id on the clickable element or its parents
        let parent = clickableElement;
        for (let i = 0; i < 3; i++) {
          // Check up to 3 levels up
          if (parent.dataset.testid && parent.dataset.testid.includes("thread")) {
            conversationId = parent.dataset.testid;
            break;
          }
          if (parent.getAttribute("id")) {
            // Or if it has an ID
            // conversationId = parent.getAttribute('id'); // This might be too generic
          }
          if (!parent.parentElement) break;
          parent = parent.parentElement;
        }
      }

      if (messageText) {
        // Check if already processed
        // This 'if' block is now preceded by the 'chatgpt-processed' check, so if we reach here, it's not processed.
        // Also ensure messageText is not empty after all checks.
        if (messageText) {
          // Ensure messageText is not empty after trimming and "You:" check
          questions.push({
            id: `q-${conversationId}-${Date.now()}`,
            text: messageText,
            sender: senderName,
            conversationId: conversationId,
            previewElement: conv,
          });
          console.log(
            `Content.js: Conv index ${index}, Sender "${senderName}": Successfully extracted UNREAD question: "${messageText}" (Conv ID: ${conversationId}). Added to processing queue.`
          );
        } else {
          console.log(`Content.js: Conv index ${index}, Sender "${senderName}": Message text was empty after all checks, skipping.`);
        }
      } else {
        // This 'else' corresponds to 'if (messageText)' before the 'chatgpt-processed' check was moved up.
        // This path should ideally not be taken if messageText was found earlier.
        // However, if messageDiv was found but messageText became empty after trim, log it.
        console.log(`Content.js: Conv index ${index}, Sender "${senderName}": Message text was effectively empty before pushing to questions array, skipping.`);
      }
    } catch (error) {
      console.error("Content.js: Error processing a conversation:", error, conv);
    }
  });

  if (questions.length === 0) {
    console.log("Content.js: No new, unread messages (not starting with 'You:') were found to process with the new selectors.");
  }
  return questions;
}

// Function to send questions to the background script (remains largely the same)
async function sendQuestionsToBackground(questions) {
  if (questions.length === 0) return;

  for (const q of questions) {
    try {
      console.log(`Content.js: Sending question to background: "${q.text}" (Sender: ${q.sender}, Conv ID: ${q.conversationId})`);

      // Mark as pending BEFORE sending
      if (q.previewElement) {
        q.previewElement.classList.add("chatgpt-pending-response");
        console.log(`Content.js: Marked conversation ${q.conversationId} as 'chatgpt-pending-response'.`);
      }

      const settings = await chrome.runtime.sendMessage({ action: "getSettings" });
      if (chrome.runtime.lastError) {
        console.error("Content.js: Error getting settings in sendQuestionsToBackground:", chrome.runtime.lastError.message);
        if (q.previewElement) q.previewElement.classList.remove("chatgpt-pending-response"); // Unmark on error
        continue;
      }

      const questionToSend = (settings && settings.customResponsePrefix ? settings.customResponsePrefix : "") + q.text;

      const response = await chrome.runtime.sendMessage({
        action: "getAnswerFromChatGPT",
        question: questionToSend,
        conversationId: q.conversationId,
      });

      if (chrome.runtime.lastError) {
        console.error("Content.js: Error sending message to background (getAnswerFromChatGPT):", chrome.runtime.lastError.message);
        if (q.previewElement) {
          q.previewElement.classList.remove("chatgpt-pending-response"); // Unmark
          console.log(`Content.js: Unmarked conversation ${q.conversationId} from 'chatgpt-pending-response' due to send error.`);
        }
        continue;
      }

      if (response && response.answer) {
        console.log(`Content.js: Received answer for ${q.conversationId}: "${response.answer}"`);
        if (q.previewElement) {
          q.previewElement.classList.remove("chatgpt-pending-response");
          console.log(`Content.js: Unmarked ${q.conversationId} from pending, preparing for delivery.`);
        }
        currentResponseToDeliver = {
          conversationId: q.conversationId,
          answer: response.answer,
          originalPreviewElement: q.previewElement, // Essential for finding and marking later
          retries: 0,
        };
        initiateResponseDeliverySequence();
        break; // IMPORTANT: Stop processing further questions, focus on delivering this one.
      } else if (response && response.error) {
        console.error(`Content.js: Error from background for question "${q.text}":`, response.error);
        if (q.previewElement) {
          q.previewElement.classList.remove("chatgpt-pending-response"); // Unmark on error from ChatGPT
          console.log(`Content.js: Unmarked conversation ${q.conversationId} from 'chatgpt-pending-response' due to ChatGPT error: ${response.error}`);
        }
      } else {
        console.log(`Content.js: No valid answer or error received from background for: "${q.text}"`);
        if (q.previewElement) {
          q.previewElement.classList.remove("chatgpt-pending-response"); // Unmark if no response/error
          console.log(`Content.js: Unmarked conversation ${q.conversationId} from 'chatgpt-pending-response' due to no answer/error.`);
        }
      }
    } catch (error) {
      console.error(`Content.js: Error in sendQuestionsToBackground loop for question "${q.text}":`, error);
      if (error.message && error.message.includes("Receiving end does not exist")) {
        console.warn("Content.js: Extension context invalidated. Please reload the page.");
        break;
      }
    }
  }
}

// --- Core Logic: Delivering the Response ---
async function initiateResponseDeliverySequence() {
  if (!currentResponseToDeliver) {
    // console.log("Content.js: No response to deliver in initiateResponseDeliverySequence.");
    isAttemptingDelivery = false; // Ensure this is reset
    return;
  }
  if (isAttemptingDelivery) {
    // console.log("Content.js: Delivery attempt already in progress for another response.");
    return;
  }

  isAttemptingDelivery = true;
  const deliveryJob = currentResponseToDeliver; // Work with the current job

  console.log(`Content.js: Initiating delivery attempt #${deliveryJob.retries + 1} for conversation ${deliveryJob.conversationId}`);
  let deliverySuccessful = false;

  try {
    // Prefer clicking the specific child if available, otherwise the whole preview element.
    const elementToActuallyClick = deliveryJob.originalPreviewElement?.querySelector("div._a6ag._a6ah") || deliveryJob.originalPreviewElement;
    let clickSuccessful = false;

    if (!elementToActuallyClick) {
      console.warn(`Content.js: Delivery - Could not find conversation preview element for ID ${deliveryJob.conversationId} to click.`);
    } else {
      console.log("Content.js: Delivery - Attempting to click conversation preview:", elementToActuallyClick);
      try {
        elementToActuallyClick.click();
        // console.log("Content.js: Delivery - Click action performed on element.");
        await new Promise((r) => setTimeout(r, 750)); // Delay for UI to update after click
        clickSuccessful = true;
      } catch (clickError) {
        console.error("Content.js: Delivery - Click failed:", clickError, elementToActuallyClick);
      }
    }

    if (clickSuccessful) {
      const specificMessageInputSelector = 'textarea[placeholder="Reply in Messenger…"]';
      // console.log(`Content.js: Delivery - Waiting for input field: ${specificMessageInputSelector}`);
      let messageInputElement = await waitForElementOnPage(specificMessageInputSelector, 7000);

      if (!messageInputElement) {
        const fallbackInputSelector = `div[aria-label*="Message"][role="textbox"], textarea[placeholder*="Message"], div[data-lexical-editor="true"]`;
        console.warn(`Content.js: Delivery - Specific input '${specificMessageInputSelector}' not found. Trying fallback: ${fallbackInputSelector}`);
        messageInputElement = document.querySelector(fallbackInputSelector);
      }

      if (messageInputElement) {
        // console.log("Content.js: Delivery - Found message input element:", messageInputElement);
        messageInputElement.focus();
        messageInputElement.value = ""; // Clear
        messageInputElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        messageInputElement.value = deliveryJob.answer; // Set new value
        messageInputElement.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        messageInputElement.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        console.log(`Content.js: Delivery - Set text in input field for ${deliveryJob.conversationId}.`);

        let sendButton = null;
        const potentialSendButtonSelectors = [
          'button[aria-label="Send"]',
          'button[data-testid="messenger_send_button"]',
          'button[aria-label*="Send message"]',
          'div[aria-label="Send"][role="button"]',
        ];
        for (const selector of potentialSendButtonSelectors) {
          // Try to find button near the input element first
          let searchScope =
            messageInputElement.closest('div[role="complementary"], div[role="form"], div[class*="chat"], div[class*="composer"]') ||
            messageInputElement.parentElement?.parentElement;
          if (searchScope) sendButton = searchScope.querySelector(selector);
          if (sendButton) break;
          sendButton = document.querySelector(selector); // Global fallback
          if (sendButton) break;
        }

        if (sendButton && !sendButton.disabled) {
          console.log("Content.js: Delivery - Send button found and enabled. Clicking.", sendButton);
          sendButton.click();
          deliverySuccessful = true;
        } else {
          if (sendButton?.disabled) console.warn("Content.js: Delivery - Send button found but is DISABLED.");
          else console.warn("Content.js: Delivery - Send button NOT FOUND.");
        }
      } else {
        console.warn(`Content.js: Delivery - Message input field not found for ${deliveryJob.conversationId}.`);
      }
    } else {
      console.warn(`Content.js: Delivery - Skipping input/send because click on conversation preview failed or element not found for ${deliveryJob.conversationId}.`);
    }
  } catch (error) {
    console.error("Content.js: Delivery - Error during delivery attempt:", error);
    deliverySuccessful = false;
  }

  // Post-delivery attempt logic
  if (deliverySuccessful) {
    console.log(`Content.js: Successfully delivered response to ${deliveryJob.conversationId}.`);
    if (deliveryJob.originalPreviewElement) {
      deliveryJob.originalPreviewElement.classList.add("chatgpt-processed");
      console.log(`Content.js: Marked conversation ${deliveryJob.conversationId} as 'chatgpt-processed'.`);
    }
    currentResponseToDeliver = null;
    isAttemptingDelivery = false;
    setTimeout(runAutomationCycle, 500); // Check for new messages fairly soon
  } else {
    console.warn(`Content.js: Delivery attempt #${deliveryJob.retries + 1} failed for ${deliveryJob.conversationId}.`);
    deliveryJob.retries++;
    if (deliveryJob.retries < MAX_DELIVERY_RETRIES) {
      console.log(`Content.js: Scheduling retry for ${deliveryJob.conversationId}.`);
      isAttemptingDelivery = false; // Allow the next attempt by resetting the flag
      setTimeout(initiateResponseDeliverySequence, 5000); // Retry after 5 seconds
    } else {
      console.error(`Content.js: Max retries reached for ${deliveryJob.conversationId}. Giving up on this response.`);
      // Optional: Mark as 'chatgpt-delivery-failed' to avoid re-processing immediately
      // if (deliveryJob.originalPreviewElement) deliveryJob.originalPreviewElement.classList.add("chatgpt-delivery-failed");
      currentResponseToDeliver = null;
      isAttemptingDelivery = false;
      setTimeout(runAutomationCycle, 500); // Check for other messages
    }
  }
}

// Main automation cycle
let mainIntervalId = null;
const POLLING_INTERVAL = 5000; // Changed to 5 seconds

async function runAutomationCycle() {
  // If a response is currently being delivered or is queued, pause the automation cycle.
  if (currentResponseToDeliver || isAttemptingDelivery) {
    // console.log("Content.js: Automation cycle paused: A response is being delivered or queued.");
    return;
  }

  const settings = await chrome.runtime.sendMessage({ action: "getSettings" });
  if (chrome.runtime.lastError) {
    console.error("Content.js: Error getting settings in runAutomationCycle:", chrome.runtime.lastError.message);
    return;
  }

  if (settings && settings.isEnabled) {
    console.log("Content.js: Automation enabled. Checking for questions with new logic...");
    const questions = extractQuestions();
    if (questions.length > 0) {
      await sendQuestionsToBackground(questions);
    } else {
      // console.log("Content.js: No new unread questions found during this cycle with new logic.");
    }
  } else {
    // console.log("Content.js: Automation is disabled via settings.");
  }
}

// Listener for messages from background script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // The 'injectResponse' action is now handled internally by initiateResponseDeliverySequence,
  // triggered when 'sendQuestionsToBackground' receives an answer.
  // So, the 'injectResponse' message from background might be deprecated or used for other purposes if needed.
  // For now, we'll keep a simple handler for 'settingsUpdated'.

  if (request.action === "settingsUpdated") {
    console.log("Content.js: Notified of settings update. Re-evaluating automation cycle.");
    stopAutomation();
    initializeAutomation();
    sendResponse({ status: "Settings acknowledged by content script" });
    return true;
  }
  console.log("Content.js: Received unhandled message action:", request.action);
  return false;
});

// Helper function to wait for an element on the Meta page (ensure this is defined outside the listener)
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

// --- MutationObserver for dynamic content changes ---
let observer = null;

function startMutationObserver() {
  if (observer) observer.disconnect();
  // Target the container of conversations or a higher-level stable element.
  // The selector "div[role='main']" might be a good candidate if it encloses the inbox.
  const targetNode = document.querySelector("div[role='main']") || document.body;
  const config = { childList: true, subtree: true };

  observer = new MutationObserver(
    debounce(async (mutationsList, obs) => {
      let relevantChangeDetected = false;
      for (const mutation of mutationsList) {
        if (mutation.type === "childList" || mutation.type === "subtree") {
          // More specific checks can be added here to see if the mutation affected conversation items
          relevantChangeDetected = true;
          break;
        }
      }
      if (relevantChangeDetected) {
        // console.log("Content.js: MutationObserver detected DOM change. Re-checking for questions.");
        await runAutomationCycle();
      }
    }, 1500)
  ); // Debounce to avoid rapid firing

  observer.observe(targetNode, config);
  console.log("Content.js: MutationObserver started on target:", targetNode);
}

function stopMutationObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
    console.log("Content.js: MutationObserver stopped.");
  }
}

function debounce(func, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

function startAutomation() {
  console.log("Content.js: Attempting to start automation with new logic...");
  runAutomationCycle();
  if (typeof MutationObserver !== "undefined") {
    startMutationObserver();
    if (mainIntervalId) clearInterval(mainIntervalId);
  } else {
    console.warn("Content.js: MutationObserver not supported, falling back to polling.");
    if (mainIntervalId) clearInterval(mainIntervalId);
    mainIntervalId = setInterval(runAutomationCycle, POLLING_INTERVAL);
  }
}

function stopAutomation() {
  console.log("Content.js: Stopping automation.");
  stopMutationObserver();
  if (mainIntervalId) {
    clearInterval(mainIntervalId);
    mainIntervalId = null;
  }
  // Reset delivery state when stopping automation
  currentResponseToDeliver = null;
  isAttemptingDelivery = false;
}

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
