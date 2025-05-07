// content.js
console.log("Meta Suite ChatGPT Bridge content script loaded (with new extraction logic2).");

// --- Global State for Response Delivery ---
let currentResponseToDeliver = null; // { conversationId: string, answer: string, originalPreviewElement: HTMLElement, retries: number }
let isAttemptingDelivery = false; // Flag to prevent concurrent delivery attempts
const MAX_DELIVERY_RETRIES = 2; // Max times to try delivering a single response
let notFoundMessages = new Set(); // Stores identifiers (e.g., "conversationId||messageText") of messages that resulted in "NOTFOUND"
let isPartialChecking = true; // Flag to control conversation scanning when partial automation is enabled
let processedConversations = new Map(); // Store IDs and timestamps of conversations we've already processed

// CSS for the "Next" button
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
      // ENHANCED CONVERSATION ID GENERATION
      // First try to extract a stable identifier from DOM attributes
      let idFound = false;

      if (clickableElement) {
        // Try to find a data-testid or data-id on the clickable element or its parents
        let parent = clickableElement;
        for (let i = 0; i < 5; i++) {
          // Check more levels up
          // Look for thread IDs in various attributes
          if (parent.dataset.testid && parent.dataset.testid.includes("thread")) {
            conversationId = parent.dataset.testid;
            console.log(`Content.js: Found stable conversation ID from data-testid: ${conversationId}`);
            idFound = true;
            break;
          }

          // Look for thread ID in href attribute
          if (parent.href && parent.href.includes("thread_id=")) {
            try {
              const threadIdMatch = parent.href.match(/thread_id=([^&]+)/);
              if (threadIdMatch && threadIdMatch[1]) {
                conversationId = `thread-${threadIdMatch[1]}`;
                console.log(`Content.js: Found stable conversation ID from href: ${conversationId}`);
                idFound = true;
                break;
              }
            } catch (e) {
              console.log("Content.js: Error extracting thread ID from href:", e);
            }
          }

          if (!parent.parentElement) break;
          parent = parent.parentElement;
        }
      }

      // If we couldn't find a stable ID from DOM attributes, create a shorter unique ID
      if (!idFound) {
        // Convert name to a simple numeric hash (without showing the name)
        function simpleHash(str) {
          let hash = 0;
          for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
          }
          return Math.abs(hash).toString().substring(0, 6); // Only use 6 digits
        }

        // Create a shorter, unique ID
        conversationId = `c${simpleHash(senderName)}`;
        console.log(`Content.js: Using short unique ID: ${conversationId} for sender: ${senderName}`);
      }

      if (messageText) {
        // Generate a unique key for this conversation + message
        const messageKey = `${conversationId}:${messageText.slice(0, 50)}`;

        // Check if we've already processed this conversation with a similar message recently
        if (processedConversations.has(messageKey)) {
          const processedTime = processedConversations.get(messageKey);
          const timeAgo = Math.round((Date.now() - processedTime) / 1000);
          console.log(
            `Content.js: Conv index ${index}, Sender "${senderName}": Already processed conversation ID ${conversationId} with similar message ${timeAgo} seconds ago, skipping.`
          );
          return; // Skip this conversation
        }

        // Check if the conversation element has already been marked as processed
        if (conv.classList.contains("chatgpt-processed") || conv.classList.contains("chatgpt-pending-response")) {
          console.log(`Content.js: Conv index ${index}, Sender "${senderName}": Conv already has processing class marker, skipping.`);
          return; // Skip this conversation
        }

        // Add an attribute to help identify the conversation
        conv.setAttribute("data-chatgpt-conversation-id", conversationId);

        // Ensure messageText is not empty after trimming and "You:" check
        questions.push({
          id: `q-${conversationId}`, // Use stable ID without timestamp
          text: messageText,
          sender: senderName,
          conversationId: conversationId,
          previewElement: conv,
        });
        console.log(
          `Content.js: Conv index ${index}, Sender "${senderName}": Successfully extracted UNREAD question: "${messageText}" (Conv ID: ${conversationId}). Added to processing queue.`
        );

        // Mark this conversation as being processed to prevent duplicate processing
        // Store both conversation ID and message content with timestamp
        processedConversations.set(messageKey, Date.now());

        // Add visual marker class and data attribute
        conv.classList.add("chatgpt-pending-response");
        conv.setAttribute("data-chatgpt-processing-time", Date.now().toString());
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

// Function to send questions to the background script with delay between requests
async function sendQuestionsToBackground(questions) {
  if (questions.length === 0) return;

  console.log(`Content.js: Processing ${questions.length} questions with delay between each`);

  // Process only one question at a time with delay between each question
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    // If this isn't the first question, add a delay to prevent "Another ChatGPT request is already in progress" errors
    if (i > 0) {
      console.log(`Content.js: Waiting 15 seconds before processing next question to avoid concurrent ChatGPT requests...`);
      await new Promise((resolve) => setTimeout(resolve, 15000)); // 15 second delay between questions
    }
    // Create a stable message key for NOTFOUND tracking
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
        // Potentially mark it visually as skipped or handled manually if desired
        // q.previewElement.classList.add("chatgpt-skipped-notfound");
        continue; // Skip to the next question
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

      // Use conversation ID as a unique identifier in the prefix instead of sender name
      const uniquePrefix = `Customer-id-${q.conversationId}\nQuestion: `;

      // Add timestamp to make each request unique even for the same question
      const uniqueId = Date.now().toString().slice(-6); // Last 6 digits of timestamp

      // Format the question with the unique conversation ID prefix (without showing request ID in prefix)
      const questionToSend = uniquePrefix + q.text;

      console.log(`Content.js: Using unique conversation ID prefix for ${q.sender}: "${uniquePrefix}" and request ID: ${uniqueId}`);

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
          // console.log(`Content.js: Added key "${stableMessageKey}" to notFoundMessages. Current notFoundMessages:`, Array.from(notFoundMessages));
          if (q.previewElement) {
            q.previewElement.classList.remove("chatgpt-pending-response");
            // Optionally, mark it visually as handled/ignored if it's "NOTFOUND"
            // q.previewElement.classList.add("chatgpt-notfound-handled");
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
      // Mark as failed to prevent retries on a stale element
      deliveryJob.retries = MAX_DELIVERY_RETRIES;
      // Do not set currentResponseToDeliver = null here, let the retry logic handle it or runAutomationCycle will pick up next.
      // No, we should clear it and let runAutomationCycle find new things if this one is truly undeliverable.
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
          if (activeSenderName !== deliveryJob.sender) {
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

              // Remove the conversation from processedConversations to allow re-processing later if needed
              if (deliveryJob.conversationId && processedConversations.has(deliveryJob.conversationId)) {
                console.log(`Content.js: Delivery - Removing conversation ${deliveryJob.conversationId} from processed cache due to delivery abort.`);
                processedConversations.delete(deliveryJob.conversationId);
              }

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

// Main automation cycle
let mainIntervalId = null;
const POLLING_INTERVAL = 5000; // Changed to 5 seconds

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
    console.log("Content.js: Automation enabled. Checking for questions with new logic...");
    // Pass notFoundMessages to extractQuestions for pre-filtering
    const questions = extractQuestions(notFoundMessages);
    if (questions.length > 0) {
      await sendQuestionsToBackground(questions);
    } else {
      // console.log("Content.js: No new unread questions found during this cycle with new logic.");
      if (notFoundMessages.size > 0) {
        console.log(
          `Content.js: No unread messages found. Clearing the 'NOTFOUND' cache which had ${notFoundMessages.size} items. Cache content before clear:`,
          Array.from(notFoundMessages)
        );
        notFoundMessages.clear();

        // Clear processedConversations periodically when no new messages are found
        // This allows re-processing messages that might not have been properly delivered
        if (processedConversations.size > 0) {
          console.log(`Content.js: Clearing processed conversations cache. Had ${processedConversations.size} items.`);
          processedConversations.clear();
        }
      }
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

// Function to clear processed conversation cache manually
function clearProcessedConversationCache() {
  const oldSize = processedConversations.size;
  processedConversations.clear();
  console.log(`Content.js: Manually cleared processed conversations cache. Had ${oldSize} items.`);

  // Remove visual markers from conversations that might have been stuck
  const pendingElements = document.querySelectorAll(".chatgpt-pending-response");
  pendingElements.forEach((el) => {
    console.log(`Content.js: Clearing visual pending marker from element:`, el.getAttribute("data-chatgpt-conversation-id"));
    el.classList.remove("chatgpt-pending-response");
  });
}

// Function to create and add the "Next" button to the page
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

function startAutomation() {
  console.log("Content.js: Attempting to start automation with new logic...");

  // Clear any existing interval to prevent multiple timers
  if (mainIntervalId) {
    clearInterval(mainIntervalId);
    mainIntervalId = null;
  }

  // Reset isPartialChecking to true when automation starts
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

  if (typeof MutationObserver !== "undefined") {
    startMutationObserver(); // MutationObserver will also trigger runAutomationCycle
  } else {
    console.warn("Content.js: MutationObserver not supported. Relying solely on polling.");
  }
}

function stopAutomation() {
  console.log("Content.js: Stopping automation.");
  stopMutationObserver();
  if (mainIntervalId) {
    clearInterval(mainIntervalId);
    console.log(`Content.js: Polling interval ${mainIntervalId} stopped.`);
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
