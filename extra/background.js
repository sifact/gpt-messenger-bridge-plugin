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
    chrome.storage.sync.get(["isEnabled", "customResponsePrefix"], (settings) => {
      if (chrome.runtime.lastError) {
        console.error("Background: Error getting settings:", chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse(settings);
      }
    });
    return true;
  } else if (request.action === "saveSettings") {
    chrome.storage.sync.set(request.settings, () => {
      if (chrome.runtime.lastError) {
        console.error("Background: Error saving settings:", chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        console.log("Background: Settings saved", request.settings);
        sendResponse({ status: "Settings saved" });
        notifyContentScriptsSettingsUpdated();
      }
    });
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
      const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
      if (tabs.length > 0) {
        chatGPTTab = tabs[0];
        // DO NOT activate the tab: await chrome.tabs.update(chatGPTTab.id, { active: true });
        console.log("Background: Found existing ChatGPT tab:", chatGPTTab.id, "(will not activate it).");
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
    const answer = await fetchChatGPTAnswer(request.question);
    console.log("Background: Sending answer to Meta content script:", answer);
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
      isEnabled: true,
      customResponsePrefix: "AI Assistant: ",
    });
    console.log("Meta Suite ChatGPT Bridge installed. Default settings saved.");
  } else if (details.reason === "update") {
    console.log("Meta Suite ChatGPT Bridge updated to version " + chrome.runtime.getManifest().version);
  }
});
