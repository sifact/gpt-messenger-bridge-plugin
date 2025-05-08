// Functions for extracting messages and questions from Meta Business Suite

// Cache for messages that were not found to be questions

// Local store for processed messages in the content script context
const processedMessages = new Set();

const processedMessageStore = {
  processedMessages,
};

// Extract questions from the page - using EXACT same code from content.js
function extractQuestions() {
  const questions = [];

  // Selector for individual conversation containers from the provided file
  const conversationContainerSelector = "div._4k8w";
  const conversations = document.querySelectorAll(conversationContainerSelector);
  // console.log(`Content.js: Found ${conversations.length} potential conversation containers using selector "${conversationContainerSelector}".`);

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
        return;
      }
      messageText = messageDiv.textContent.trim();

      if (messageText.toLowerCase().startsWith("you:") || messageText.toLowerCase().startsWith("you: ")) {
        // click this conversation
        console.log("starting with you");
        const clickableElement = conv.querySelector("div._a6ag._a6ah");
        try {
          clickableElement.click();
          console.log(`clicked unread...`);
        } catch (error) {
          console.log("Content.js: Error clicking conversation:", error);
        }

        return;
      }

      const clickableElement = conv.querySelector("div._a6ag._a6ah");
      let idFound = false;

      if (clickableElement) {
        let parent = clickableElement;
        for (let i = 0; i < 5; i++) {
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
        const messageKey = `${conversationId}:${messageText?.trim()?.slice(0, 50)}`;
        if (processedMessageStore.processedMessages.has(messageKey)) {
          console.log(`Content.js: Message already processed, skipping: ${messageKey}`);
          return;
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
    console.log("Content.js: No new, unread messages.");
  }
  return questions;
}

// Process a conversation to extract details
function processConversation(conversationId) {
  // Find the conversation container by the data attribute we set
  const container = document.querySelector(`[data-chatgpt-conversation-id="${conversationId}"]`);
  if (!container) {
    console.log(`Processing conversation: ${conversationId} - Container not found`);
    return null;
  }

  // Extract details using the same selectors as in extractQuestions
  const usernameElement = container.querySelector(".xmi5d70");
  const messageDiv = container.querySelector("div._4k8y ._4ik4._4ik5");

  return {
    id: conversationId,
    customerName: usernameElement ? usernameElement.textContent.trim() : "Unknown Customer",
    lastMessage: messageDiv ? messageDiv.textContent.trim() : "No message found",
  };
}

export { extractQuestions, processConversation, processedMessageStore };
