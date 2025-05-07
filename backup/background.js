// background.js
console.log("Background service worker started.");

// --- Core Logic: Listener for messages ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background: Message received", request);

  if (request.action === "getAnswerFromChatGPT") {
    handleGetAnswerFromChatGPT(request, sendResponse);
    return true; // Indicates an asynchronous response.
  } else if (request.action === "openConversationAndRespond") {
    handleOpenConversationAndRespond(request, sender, sendResponse);
    return true; // Indicates an asynchronous response.
  } else if (request.action === "getSettings") {
    chrome.storage.sync.get(["isEnabled", "isPartialAutomation"], (settings) => {
      if (chrome.runtime.lastError) {
        console.error("Background: Error getting settings:", chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        // Set default values if settings are undefined
        if (settings.isEnabled === undefined) {
          console.log("Background: isEnabled setting not found, using default value: false");
          settings.isEnabled = false;
        }

        if (settings.isPartialAutomation === undefined) {
          console.log("Background: isPartialAutomation setting not found, using default value: false");
          settings.isPartialAutomation = false;
        }

        // We no longer use a static prefix - the customer name will be dynamically added in content.js
        settings.customResponsePrefix = "";

        console.log("Background: Returning settings:", settings);
        sendResponse(settings);
      }
    });
    return true;
  } else if (request.action === "saveSettings") {
    // Save both isEnabled and isPartialAutomation settings
    console.log("Background: Saving settings received from popup:", request.settings);
    chrome.storage.sync.set(
      {
        isEnabled: request.settings.isEnabled === true,
        isPartialAutomation: request.settings.isPartialAutomation === true,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Background: Error saving settings:", chrome.runtime.lastError.message);
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          console.log("Background: Settings successfully saved:", request.settings);
          // Verify what was actually saved
          chrome.storage.sync.get(["isEnabled", "isPartialAutomation"], (verifySettings) => {
            console.log("Background: Verification - settings after save:", verifySettings);
          });
          sendResponse({ status: "Settings saved" });
          notifyContentScriptsSettingsUpdated();
        }
      }
    );
    return true;
  } else if (request.action === "chatGPTResponse") {
    // Message from chatgpt-interactor.js
    console.log("Background: Received response from ChatGPT Interactor:", request.answer || request.error);
    // We need a way to correlate this response to the original request.
    // This requires a more robust callback/promise management system if multiple requests can be in flight.
    // For simplicity, assuming one request at a time for now.
    if (activeChatGPTResolver) {
      if (request.answer) {
        activeChatGPTResolver.resolve(request.answer);
      } else {
        activeChatGPTResolver.reject(request.error || "Unknown error from ChatGPT interactor");
      }
      activeChatGPTResolver = null; // Clear resolver
    }
    sendResponse({ status: "Response noted by background" }); // Acknowledge message
    return true;
  }
});

// --- Action Handlers ---

let activeChatGPTResolver = null; // To store the resolve/reject functions of the current ChatGPT request promise
let processedQuestions = new Map(); // To track recently processed questions and avoid duplicates

// Create a hash from the full question text
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString();
}

// This will help prevent multiple responses for the same question by the same user
function trackProcessedQuestion(question, conversationId) {
  // Use full conversation ID and question hash to ensure uniqueness
  const questionHash = hashString(question);
  const key = `${conversationId}:${questionHash}`;
  const now = Date.now();

  console.log(`Background: Tracking question - Key: ${key}, Time: ${new Date(now).toLocaleTimeString()}`);
  processedQuestions.set(key, now);

  // Clean up old entries (older than 3 minutes for testing, adjust as needed)
  const purgeTime = 3 * 60 * 1000; // 3 minutes
  for (const [storedKey, timestamp] of processedQuestions.entries()) {
    if (now - timestamp > purgeTime) {
      console.log(`Background: Removing stale question tracking - Key: ${storedKey}, Age: ${(now - timestamp) / 1000}s`);
      processedQuestions.delete(storedKey);
    }
  }
}

function isQuestionAlreadyProcessed(question, conversationId) {
  const questionHash = hashString(question);
  const key = `${conversationId}:${questionHash}`;
  const isProcessed = processedQuestions.has(key);

  if (isProcessed) {
    console.log(`Background: Detected duplicate question - Key: ${key}`);
    // Get timestamp of when it was processed
    const timestamp = processedQuestions.get(key);
    const secondsAgo = (Date.now() - timestamp) / 1000;
    console.log(`Background: Original question was processed ${secondsAgo.toFixed(1)} seconds ago`);
  }

  return isProcessed;
}

async function fetchChatGPTAnswer(question) {
  console.log("Background: Attempting to fetch answer from ChatGPT web UI for:", question);

  return new Promise(async (resolve, reject) => {
    if (activeChatGPTResolver) {
      reject("Another ChatGPT request is already in progress.");
      return;
    }
    activeChatGPTResolver = { resolve, reject }; // Store for when chatGPTResponse message comes

    let chatGPTTab = null;
    try {
      // Check if a ChatGPT tab is already open
      const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" }); // CORRECTED URL
      if (tabs.length > 0) {
        chatGPTTab = tabs[0];
        // Temporarily re-activate the tab to see if it fixes response extraction
        await chrome.tabs.update(chatGPTTab.id, { active: true });
        console.log("Background: Found existing ChatGPT tab:", chatGPTTab.id, "(activating it for interaction).");
        // Ensure it's fully loaded before injecting scripts, even if it's an existing tab.
        await waitForTabLoad(chatGPTTab.id, 5000); // Wait up to 5s for existing tab to be ready
      } else {
        // DO NOT create a new tab.
        console.error("Background: No existing ChatGPT tab found. Please open ChatGPT manually.");
        // Reject the promise so the error propagates
        // No need to call activeChatGPTResolver.reject here as the throw will be caught by the outer catch block
        throw new Error("No ChatGPT tab found. Please open chat.openai.com and try again.");
      }

      // The check below is still valid, as chatGPTTab might be null if the 'else' was hit (though throw should prevent reaching here)
      // However, to be absolutely safe after removing the creation part:
      if (!chatGPTTab || !chatGPTTab.id) {
        // This case should ideally not be reached if the 'else' block above throws.
        throw new Error("ChatGPT tab could not be identified.");
      }

      // Inject the interactor script
      await chrome.scripting.executeScript({
        target: { tabId: chatGPTTab.id },
        files: ["chatgpt-interactor.js"],
      });
      console.log("Background: Injected chatgpt-interactor.js into tab:", chatGPTTab.id);

      // Send the question to the interactor script
      // Wait a brief moment for the script to be ready
      await new Promise((r) => setTimeout(r, 500));
      chrome.tabs.sendMessage(
        chatGPTTab.id,
        {
          action: "askQuestion",
          question: question,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("Background: Error sending question to chatgpt-interactor:", chrome.runtime.lastError.message);
            if (activeChatGPTResolver) activeChatGPTResolver.reject(chrome.runtime.lastError.message);
            activeChatGPTResolver = null;
          } else if (response && response.status === "processing") {
            console.log("Background: Question sent to chatgpt-interactor, awaiting response.");
            // The actual answer will come via a separate "chatGPTResponse" message
          } else {
            console.warn("Background: Unexpected response from chatgpt-interactor on askQuestion:", response);
            if (activeChatGPTResolver) activeChatGPTResolver.reject("Unexpected response from interactor: " + JSON.stringify(response));
            activeChatGPTResolver = null;
          }
        }
      );

      // Set a timeout for the ChatGPT interaction
      setTimeout(() => {
        if (activeChatGPTResolver) {
          console.warn("Background: ChatGPT interaction timed out.");
          activeChatGPTResolver.reject("ChatGPT interaction timed out.");
          activeChatGPTResolver = null;
        }
      }, 60000); // 60-second timeout
    } catch (error) {
      console.error("Background: Error in fetchChatGPTAnswer process:", error);
      if (activeChatGPTResolver) activeChatGPTResolver.reject(error.message || "Failed to interact with ChatGPT tab");
      activeChatGPTResolver = null;
      // Optionally close the created tab if it was just for this and an error occurred early
      // if (chatGPTTab && !tabs.length > 0) { /* chrome.tabs.remove(chatGPTTab.id); */ }
    }
  });
}

// Helper function to wait for a tab to complete loading
async function waitForTabLoad(tabId, timeout = 10000) {
  console.log(`Background: Waiting for tab ${tabId} to load...`);
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        console.log(`Background: Tab ${tabId} finished loading at URL: ${tab.url}`);
        // Add a small extra delay for SPA rendering after 'complete' status
        await new Promise((resolve) => setTimeout(resolve, 500));
        return;
      }
    } catch (e) {
      console.error(`Background: Error getting tab ${tabId} status during waitForTabLoad:`, e);
      throw new Error(`Tab ${tabId} might have been closed or an error occurred.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250)); // Poll every 250ms
  }
  console.warn(`Background: Tab ${tabId} did not complete loading within ${timeout / 1000} seconds.`);
  // Optionally throw an error or just proceed with caution
  // throw new Error(`Tab ${tabId} timed out while loading.`);
}

async function handleGetAnswerFromChatGPT(request, sendResponse) {
  try {
    // Process all questions without duplicate checking
    const answer = await fetchChatGPTAnswer(request.question);

    // Truncate long answers in logs to keep console clean
    console.log("Background: Sending answer to Meta content script:", answer.length > 50 ? answer.substring(0, 50) + "..." : answer);

    sendResponse({ answer: answer });
  } catch (error) {
    console.error("Background: Error getting answer from ChatGPT UI:", error);
    sendResponse({ error: "Failed to get answer from ChatGPT UI: " + error });
  }
}

async function handleOpenConversationAndRespond(request, sender, sendResponse) {
  const { conversationId, answer } = request;
  console.log(`Background: Attempting to open/focus conversation ${conversationId} and respond.`);

  const metaInboxUrlPattern = "https://business.facebook.com/latest/inbox/*";
  const metaDomainPattern = "https://*.meta.com/business/inbox/*";

  let tabs = await chrome.tabs.query({ url: [metaInboxUrlPattern, metaDomainPattern] });
  let targetTab = null;

  if (tabs.length > 0) {
    targetTab = tabs[0];
    await chrome.tabs.update(targetTab.id, { active: true });
    await chrome.windows.update(targetTab.windowId, { focused: true });
    console.log(`Background: Found existing Meta inbox tab ${targetTab.id}, focusing it.`);
  } else {
    try {
      targetTab = await chrome.tabs.create({ url: "https://business.facebook.com/latest/inbox/", active: true });
      console.log(`Background: No Meta inbox tab found. Created new tab ${targetTab.id}.`);
      await new Promise((r) => setTimeout(r, 3000)); // Wait for tab to load
    } catch (e) {
      console.error("Background: Error creating new tab:", e);
      sendResponse({ status: "Error creating tab", error: e.message });
      return;
    }
  }

  if (targetTab && targetTab.id) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        func: forwardInjectCommandToContentScript,
        args: [request.conversationId, request.answer],
      });
      console.log(`Background: Script execution initiated in tab ${targetTab.id} for conversation ${conversationId}.`);
      sendResponse({ status: "Response injection initiated." });
    } catch (error) {
      console.error(`Background: Error executing script in tab ${targetTab.id}:`, error);
      sendResponse({ status: "Error executing script", error: error.message });
    }
  } else {
    console.error("Background: No target tab could be identified or created.");
    sendResponse({ status: "Failed to find or create Meta inbox tab." });
  }
}

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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.sync.set({
      isEnabled: false, // Changed: Default to disabled as requested
      isPartialAutomation: false, // Default to full automation
    });
    console.log("Background: Default settings saved on install - isEnabled: false");
    console.log("Meta Suite ChatGPT Bridge installed. Default settings saved. Automation is OFF by default.");
  } else if (details.reason === "update") {
    console.log("Meta Suite ChatGPT Bridge updated to version " + chrome.runtime.getManifest().version);
  }
});
