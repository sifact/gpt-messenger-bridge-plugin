// Functions for handling messages and sending them to the background script

import { notFoundMessages } from "./messageExtractor.js";
import { waitForElementOnPage } from "./utils.js";
import { runAutomationCycle } from "./automation.js";

// Global state for response delivery
let currentResponseToDeliver = null;
let isAttemptingDelivery = false;
const MAX_DELIVERY_RETRIES = 2;

// Send questions to the background script
async function sendQuestionsToBackground(questions) {
  if (questions.length === 0) return;

  console.log(`Content.js: Processing ${questions.length} questions with delay between each`);

  // Process only one question at a time with delay between each question
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    // If this isn't the first question, add a delay to prevent "Another ChatGPT request is already in progress" errors
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }

    let stableMessageKey;
    if (q.conversationId && !q.conversationId.startsWith("new-convo-")) {
      stableMessageKey = q.conversationId + "||" + q.text;
    } else {
      stableMessageKey = q.sender + "||" + q.text;
    }

    try {
      if (notFoundMessages.has(stableMessageKey)) {
        console.log(`Content.js: Skipping question for ${q.conversationId} as it previously resulted in "NOTFOUND": "${q.text}"`);
        if (q.previewElement && q.previewElement.classList.contains("chatgpt-pending-response")) {
          q.previewElement.classList.remove("chatgpt-pending-response");
        }

        continue;
      }

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

      const uniquePrefix = `Customer-id-${q.conversationId}\nQuestion: `;

      // Add timestamp to make each request unique even for the same question
      const uniqueId = Date.now().toString().slice(-6); // Last 6 digits of timestamp

      const questionToSend = uniquePrefix + q.text;

      const response = await chrome.runtime.sendMessage({
        action: "getAnswerFromChatGPT",
        question: questionToSend,
        conversationId: q.conversationId,
        requestId: uniqueId, // Add request ID as separate parameter for tracking
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

        if (response.answer === "NOTFOUND") {
          // Use the correctly defined stableMessageKey
          console.log(`Content.js: Response for ${q.conversationId} (key: "${stableMessageKey}") is "NOTFOUND". Adding to ignore list and skipping delivery.`);
          console.log(`Content.js: Adding key "${stableMessageKey}" to notFoundMessages. Current size before add: ${notFoundMessages.size}`);
          notFoundMessages.add(stableMessageKey);

          if (q.previewElement) {
            q.previewElement.classList.remove("chatgpt-pending-response");
            console.log(`Content.js: Unmarked ${q.conversationId} from pending due to "NOTFOUND".`);
          }
          currentResponseToDeliver = null; // Ensure no delivery is attempted
          isAttemptingDelivery = false; // Ensure delivery flag is reset
          continue; // Move to the next question, do not break or deliver.
        }

        // If it's a normal answer (not "NOTFOUND")
        if (q.previewElement) {
          q.previewElement.classList.remove("chatgpt-pending-response");
          console.log(`Content.js: Unmarked ${q.conversationId} from pending, preparing for delivery.`);
        }
        // Ensure the context for currentResponseToDeliver is from the correct 'q' object
        currentResponseToDeliver = {
          conversationId: q.conversationId, // from the current question object 'q'
          sender: q.sender, // from 'q'
          originalQuestionText: q.text, // from 'q'
          answer: response.answer, // from the background script's response
          originalPreviewElement: q.previewElement, // from 'q'
          retries: 0,
        };
        console.log(
          `Content.js: Staging response for delivery. Conv ID: ${currentResponseToDeliver.conversationId}, Sender: ${currentResponseToDeliver.sender}, Original Q: "${currentResponseToDeliver.originalQuestionText}", Answer: "${currentResponseToDeliver.answer}"`
        );
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

// Function to initiate the response delivery sequence
async function initiateResponseDeliverySequence() {
  if (!currentResponseToDeliver) {
    isAttemptingDelivery = false; // Ensure this is reset
    return;
  }
  if (isAttemptingDelivery) {
    // console.log("Content.js: Delivery attempt already in progress for another response.");
    return;
  }

  isAttemptingDelivery = true;
  const deliveryJob = currentResponseToDeliver; // Work with the current job

  // Safe preview of question text for logging - handles questions of any length
  const previewText = deliveryJob.originalQuestionText.length > 30 ? `${deliveryJob.originalQuestionText.substring(0, 30)}...` : deliveryJob.originalQuestionText;

  console.log(
    `Content.js: Initiating delivery attempt #${deliveryJob.retries + 1} for conversation ${deliveryJob.conversationId} (Sender: ${
      deliveryJob.sender
    }, Original Q: "${previewText}")`
  );
  let deliverySuccessful = false;

  try {
    const elementToActuallyClick = deliveryJob.originalPreviewElement?.querySelector("div._a6ag._a6ah") || deliveryJob.originalPreviewElement;
    let clickSuccessful = false;

    if (!elementToActuallyClick || !document.body.contains(elementToActuallyClick)) {
      console.warn(
        `Content.js: Delivery - Conversation preview element for ID ${deliveryJob.conversationId} (Sender: ${deliveryJob.sender}) is NOT FOUND or STALE. Aborting delivery for this response.`
      );

      deliveryJob.retries = MAX_DELIVERY_RETRIES;

      currentResponseToDeliver = null;
      isAttemptingDelivery = false;
      setTimeout(runAutomationCycle, 500); // Check for other messages
      return; // Critical: exit if element is bad
    } else {
      console.log(
        `Content.js: Delivery - Attempting to click conversation preview for Conv ID: ${deliveryJob.conversationId}, Sender: ${deliveryJob.sender}:`,
        elementToActuallyClick
      );
      try {
        console.log(`Content.js: Clicking on conversation element for ${deliveryJob.conversationId}...`);
        elementToActuallyClick.click();
        await new Promise((r) => setTimeout(r, 2000)); // Increased delay for UI to update

        // ---- Verification Step ----
        // Attempt to identify the currently open chat's sender name from the header
        // This selector needs to be robust for the active chat's header/name
        const activeChatHeaderSelector =
          "div[role='main'] span.x1lliihq.x1plvlek.xryxfnj.x1n2onr6.x193iq5w.xeeoieq.x1fj2vde.x100vrsf.x1jchvi3.x1fcty0u.x132q4wb.x13fuv20.xu3j5b3.x1q0q8m5.x26u7qi.x972fbf.xcfux6l.x1qhh985.xm0m39n.x9f619.x1s65kcs.x1ypdohk.x78zum5.x1i64zmx.x1rdy4ex.x17w43d7.x1ye3gou.xt62z39.x1x521is.x16tdsg8.x1hl2dhg.xggy1nq.x1ja2u2z.x1t137rt.x1q0g3np.x87ps6o.x1lku1pv.x1a2a7pz.x6s0dn4.x10wh9bi.x1wdrske.x8du52y.x17z4h18";
        const activeChatNameElement = document.querySelector(activeChatHeaderSelector);
        if (activeChatNameElement) {
          const activeSenderName = activeChatNameElement.textContent.trim();
          console.log(`Content.js: Delivery - Post-click: Intended sender: "${deliveryJob.sender}", Active chat sender found in UI: "${activeSenderName}"`);

          // If we detect a mismatch, abort this delivery
          if (activeSenderName !== deliveryJob?.sender) {
            console.error(`Content.js: Delivery - CRITICAL MISMATCH! Clicked on preview for "${deliveryJob.sender}" but active chat is with "${activeSenderName}".`);
            console.error("Content.js: Delivery - Aborting to prevent sending response to the wrong person!");
            currentResponseToDeliver = null;
            isAttemptingDelivery = false;
            setTimeout(runAutomationCycle, 500);
            return; // Critical: abort delivery if sender doesn't match
          }
        } else {
          console.warn(`Content.js: Delivery - Post-click: Could not identify active chat sender name in UI to verify target for "${deliveryJob.sender}".`);
        }
        // ---- End Verification Step ----

        // ---- Last Message Check ----
        // Check if the last message in the conversation is from the customer
        try {
          // Find the last message in the conversation
          const messageContainers = document.querySelectorAll('div[role="row"]');
          if (messageContainers && messageContainers.length > 0) {
            // Get the last message container
            const lastMessageContainer = messageContainers[messageContainers.length - 1];

            // Try to determine if the last message is from the customer
            // Look for typical customer message indicators vs our message indicators
            const isFromCustomer = !lastMessageContainer.querySelector('div[data-author-is-self="true"]');

            console.log(`Content.js: Delivery - Last message appears to be from ${isFromCustomer ? "customer" : "us/page"}`);

            if (!isFromCustomer) {
              console.warn(`Content.js: Delivery - Aborting response as the last message is not from the customer but from us/page.`);
              deliveryJob.retries = MAX_DELIVERY_RETRIES; // Prevent further retries
              currentResponseToDeliver = null;
              isAttemptingDelivery = false;

              // processedConversations Map has been removed

              setTimeout(runAutomationCycle, 500);
              return; // Exit delivery attempt
            } else {
              console.log(`Content.js: Delivery - Last message is from customer, proceeding with delivery.`);
            }
          } else {
            console.warn(`Content.js: Delivery - Could not find message containers to check last message sender.`);
            // Continue anyway since we couldn't verify
          }
        } catch (lastMessageError) {
          console.error("Content.js: Delivery - Error checking last message sender:", lastMessageError);
          // Continue anyway since this is a new check
        }
        // ---- End Last Message Check ----

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
          if (window.isPartialAutomationEnabled) {
            console.log("Content.js: Delivery - Partial Automation mode - NOT clicking send button. Message ready for manual review and sending.");
            // Set isPartialChecking to false when message is added in draft but not submitted
            isPartialChecking = false;
            console.log("Content.js: Set isPartialChecking to false because message was added as draft.");

            // Ensure the Next button is visible
            addNextButton();

            // The response is already in the input box, mark as successful since we've done what we need to
            deliverySuccessful = true;
          } else {
            console.log("Content.js: Delivery - Send button found and enabled. Clicking.", sendButton);
            sendButton.click();
            // In full automation mode, always keep isPartialChecking true
            isPartialChecking = true;
            deliverySuccessful = true;
          }
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

    // Don't clear from processedConversations on successful delivery
    // This prevents re-processing the same conversation multiple times

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

// Function to inject a response into a conversation
async function injectResponse(conversationId, answer) {
  console.log(`Content.js: Injecting response for ${conversationId}: "${answer}"`);

  // Placeholder for actual injection logic
  // In a real implementation, this would find the conversation and input the response

  return true; // Return success status
}

export { sendQuestionsToBackground, injectResponse, initiateResponseDeliverySequence };
