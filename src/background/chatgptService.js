import { resolverStore } from "./state.js"; // Import the activeChatGPTResolver variable

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

async function fetchChatGPTAnswer(question) {
  console.log("Background: Attempting to fetch answer from ChatGPT web UI for:", question);

  return new Promise(async (resolve, reject) => {
    if (resolverStore.activeChatGPTResolver) {
      reject("Another ChatGPT request is already in progress.");
      return;
    }
    resolverStore.activeChatGPTResolver = { resolve, reject }; // Store for when chatGPTResponse message comes

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
        files: ["./chatgpt/chatgpt-interactor.js"],
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
            if (resolverStore.activeChatGPTResolver) resolverStore.activeChatGPTResolver.reject(chrome.runtime.lastError.message);
            resolverStore.activeChatGPTResolver = null;
          } else if (response && response.status === "processing") {
            console.log("Background: Question sent to chatgpt-interactor, awaiting response.");
            // The actual answer will come via a separate "chatGPTResponse" message
          } else {
            console.warn("Background: Unexpected response from chatgpt-interactor on askQuestion:", response);
            if (resolverStore.activeChatGPTResolver) resolverStore.activeChatGPTResolver.reject("Unexpected response from interactor: " + JSON.stringify(response));
            resolverStore.activeChatGPTResolver = null;
          }
        }
      );

      // Set a timeout for the ChatGPT interaction
      setTimeout(() => {
        if (resolverStore.activeChatGPTResolver) {
          console.warn("Background: ChatGPT interaction timed out.");
          resolverStore.activeChatGPTResolver.reject("ChatGPT interaction timed out.");
          resolverStore.activeChatGPTResolver = null;
        }
      }, 60000); // 60-second timeout
    } catch (error) {
      console.error("Background: Error in fetchChatGPTAnswer process:", error);
      if (resolverStore.activeChatGPTResolver) resolverStore.activeChatGPTResolver.reject(error.message || "Failed to interact with ChatGPT tab");
      resolverStore.activeChatGPTResolver = null;
      // Optionally close the created tab if it was just for this and an error occurred early
      // if (chatGPTTab && !tabs.length > 0) { /* chrome.tabs.remove(chatGPTTab.id); */ }
    }
  });
}

export { fetchChatGPTAnswer };
