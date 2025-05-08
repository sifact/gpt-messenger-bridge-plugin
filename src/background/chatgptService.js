import { resolverStore } from "./state.js"; // Import the activeChatGPTResolver variable

// Helper function to clear the resolver store
function clearResolverStore() {
  if (resolverStore.timeoutId) {
    clearTimeout(resolverStore.timeoutId);
    resolverStore.timeoutId = null;
  }
  resolverStore.activeChatGPTResolver = null;
  console.log("Background: Cleared resolver store");
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

async function fetchChatGPTAnswer(question) {
  console.log("Background: Attempting to fetch answer from ChatGPT web UI for:", question);
  console.log("Background: Current state of resolverStore:", resolverStore?.activeChatGPTResolver);

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
        await chrome.tabs.update(chatGPTTab.id, { active: true });
        console.log("Background: Found existing ChatGPT tab:", chatGPTTab.id, "(activating it for interaction).");
        await waitForTabLoad(chatGPTTab.id, 5000);
      } else {
        chatGPTTab = await chrome.tabs.create({ url: "https://chatgpt.com/*", active: true });
        await waitForTabLoad(chatGPTTab.id, 15000);
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
            clearResolverStore();
          } else if (response && response.status === "processing") {
            console.log("Background: Question sent to chatgpt-interactor, awaiting response.");
            // The actual answer will come via a separate "chatGPTResponse" message
          } else {
            console.warn("Background: Unexpected response from chatgpt-interactor on askQuestion:", response);
            if (resolverStore.activeChatGPTResolver) resolverStore.activeChatGPTResolver.reject("Unexpected response from interactor: " + JSON.stringify(response));
            clearResolverStore();
          }
        }
      );

      // Set a timeout for the ChatGPT interaction
      const timeoutId = setTimeout(() => {
        if (resolverStore.activeChatGPTResolver) {
          console.warn("Background: ChatGPT interaction timed out.");
          resolverStore.activeChatGPTResolver.reject("ChatGPT interaction timed out.");
          clearResolverStore();
        }
      }, 60000); // 60-second timeout

      // Store the timeout ID in the resolver store so we can clear it if needed
      resolverStore.timeoutId = timeoutId;
    } catch (error) {
      console.error("Background: Error in fetchChatGPTAnswer process:", error);
      if (resolverStore.activeChatGPTResolver) resolverStore.activeChatGPTResolver.reject(error.message || "Failed to interact with ChatGPT tab");
      clearResolverStore();
      // Optionally close the created tab if it was just for this and an error occurred early
      // if (chatGPTTab && !tabs.length > 0) { /* chrome.tabs.remove(chatGPTTab.id); */ }
    }
  });
}

export { fetchChatGPTAnswer, clearResolverStore };
