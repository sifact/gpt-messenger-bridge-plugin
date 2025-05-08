// chatgpt-interactor.js
console.log("ChatGPT Interactor content script loaded.");

// Simple tracking for the last processed question
let lastProcessedQuestion = "";
let lastProcessTime = 0;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "askQuestion") {
    console.log("ChatGPT Interactor: Received question:", request.question);

    // Check if this exact question was processed recently (within 5 seconds)
    if (request.question === lastProcessedQuestion && Date.now() - lastProcessTime < 5000) {
      console.warn("ChatGPT Interactor: Question is the same as last processed very recently. Skipping.");
      sendResponse({ status: "skipped_recent_duplicate" });
      return true;
    }

    // Update tracking variables
    lastProcessedQuestion = request.question;
    lastProcessTime = Date.now();

    submitQuestionToChatGPT(request.question)
      .then((answer) => {
        console.log("ChatGPT Interactor: Sending answer back to background:", answer);
        chrome.runtime.sendMessage({ action: "chatGPTResponse", answer: answer }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("ChatGPT Interactor: Error sending answer to background:", chrome.runtime.lastError.message);
          } else {
            console.log("ChatGPT Interactor: Background acknowledged answer:", response);
          }
        });
      })
      .catch((error) => {
        console.error("ChatGPT Interactor: Error processing question:", error);
        chrome.runtime.sendMessage({ action: "chatGPTResponse", error: error.toString() }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("ChatGPT Interactor: Error sending error to background:", chrome.runtime.lastError.message);
          } else {
            console.log("ChatGPT Interactor: Background acknowledged error:", response);
          }
        });
      });
    sendResponse({ status: "processing" });
    return true;
  }
});

async function submitQuestionToChatGPT(question) {
  return new Promise(async (resolve, reject) => {
    try {
      const inputSelector = "div#prompt-textarea[contenteditable='true']";
      let inputField = await waitForElement(inputSelector, 10000);

      if (!inputField) {
        const fallbackTextareaSelector = "textarea#prompt-textarea";
        console.log("ChatGPT Interactor: Contenteditable div not found, trying textarea fallback:", fallbackTextareaSelector);
        inputField = await waitForElement(fallbackTextareaSelector, 2000);
        if (!inputField) {
          throw new Error("ChatGPT input field (div#prompt-textarea or textarea#prompt-textarea) not found.");
        }
        console.log("ChatGPT Interactor: Fallback textarea input field found.");
      } else {
        console.log("ChatGPT Interactor: Contenteditable input field found:", inputField);
      }

      inputField.focus();

      if (inputField.isContentEditable) {
        console.log("ChatGPT Interactor: Clearing contenteditable field.");
        inputField.innerHTML = ""; // Clear it first

        if (question === "") {
          console.log("ChatGPT Interactor: Setting empty question to <p><br></p>");
          inputField.innerHTML = "<p><br></p>";
        } else {
          const formattedQuestion = "<p>" + question.replace(/\n/g, "</p><p>") + "</p>";
          console.log("ChatGPT Interactor: Setting formatted question:", formattedQuestion);
          inputField.innerHTML = formattedQuestion;
        }

        inputField.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

        inputField.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      } else if (inputField.tagName === "TEXTAREA") {
        inputField.value = question;
        inputField.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      } else {
        inputField.textContent = question;
        inputField.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      }

      // Re-focus just in case, and final log of what the DOM sees as text content
      inputField.focus();

      let currentTextInBox = "";
      if (inputField.isContentEditable) {
        const paragraphs = inputField.querySelectorAll("p");
        const lines = [];
        paragraphs.forEach((p) => lines.push(p.textContent));
        currentTextInBox = lines.join("\n");
      } else {
        currentTextInBox = inputField.value;
      }

      if (currentTextInBox.trim() !== question.trim()) {
        console.error(`ChatGPT Interactor: CRITICAL - Text in box ("${currentTextInBox.trim()}") does not match question ("${question.trim()}"). Halting before submission.`);
      } else {
        console.log("ChatGPT Interactor: Text successfully set and verified in input field.");
      }

      // Wait a bit longer for the UI to react, especially for the send button to enable
      await new Promise((r) => setTimeout(r, 300));

      // --- Step 3: Attempt to submit ---
      let submissionSuccessful = false;
      const potentialSendButtonSelectors = [
        "button#composer-submit-button[data-testid='send-button']", // Most specific
        "button[data-testid='send-button']",
        "button[aria-label*='Send']", // More generic
        "button[aria-label*='Submit']",
        // Add other selectors if new UIs emerge, e.g., based on SVG path or parent structure
        "form button[type='submit']", // A common pattern
      ];

      // Try clicking a send button first
      for (const selector of potentialSendButtonSelectors) {
        const button = document.querySelector(selector);
        if (button && !button.disabled) {
          console.log(`ChatGPT Interactor: Found enabled send button with selector "${selector}". Clicking it.`, button);
          button.click();
          submissionSuccessful = true;
          break;
        }
      }

      if (!submissionSuccessful) {
        console.log("ChatGPT Interactor: No enabled send button found directly. Attempting Enter key simulation.");
        inputField.focus(); // Ensure focus
        inputField.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 750)); // Wait a bit longer for Enter to process

        // Check if input field was cleared or changed significantly
        // This check is a heuristic. Some UIs might not clear it immediately or fully.
        const currentTextAfterEnter = inputField.isContentEditable ? inputField.textContent.trim() : inputField.value.trim();
        const questionTrimmed = question.trim();
        if (currentTextAfterEnter === questionTrimmed && questionTrimmed !== "") {
          // Don't flag if question was empty
          console.warn(
            "ChatGPT Interactor: Input field still contains the question after Enter simulation. Submission might be pending or failed. Will try to click button again if available."
          );
        } else if (questionTrimmed !== "" && currentTextAfterEnter !== "") {
          console.log("ChatGPT Interactor: Input field content changed or cleared after Enter. Assuming submission initiated.");
          submissionSuccessful = true; // Assume Enter worked if text changed or cleared
        } else if (questionTrimmed === "" && currentTextAfterEnter === "") {
          console.log("ChatGPT Interactor: Empty question submitted via Enter (assumed).");
          submissionSuccessful = true;
        } else {
          // If question was not empty, but input is now empty, it's a good sign.
          submissionSuccessful = true;
          console.log("ChatGPT Interactor: Input field cleared after Enter. Assuming submission successful.");
        }

        // If Enter key *seemed* to fail (text didn't clear and was not empty), try clicking any send button again.
        // This handles cases where Enter enables a button that was previously disabled.
        if (currentTextAfterEnter === questionTrimmed && questionTrimmed !== "") {
          console.log("ChatGPT Interactor: Enter might not have submitted. Trying to click a send button again.");
          submissionSuccessful = false; // Reset as Enter was inconclusive
          for (const selector of potentialSendButtonSelectors) {
            const button = document.querySelector(selector);
            // Check if button is now enabled (it might have been disabled before Enter)
            if (button && !button.disabled) {
              console.log(`ChatGPT Interactor: Found enabled send button (after Enter attempt) with selector "${selector}". Clicking it.`, button);
              button.click();
              submissionSuccessful = true;
              break;
            }
          }
        }
      }

      if (!submissionSuccessful) {
        // Final check: if after all attempts, the input field for a non-empty question still contains the exact question,
        // and no button click was registered as successful, then it's likely a failure.
        const finalTextInBox = inputField.isContentEditable ? inputField.textContent.trim() : inputField.value.trim();
        if (finalTextInBox === question.trim() && question.trim() !== "") {
          // Check if any send button is present and disabled (indicates waiting for response)
          for (const selector of potentialSendButtonSelectors) {
            const button = document.querySelector(selector);
            if (button && button.disabled) {
              console.log("ChatGPT Interactor: A send button is present and disabled. Assuming submission is processing despite text not clearing.");
              submissionSuccessful = true; // Override: assume it's processing
              break;
            }
          }
          if (!submissionSuccessful) {
            // Only throw if no button is disabled (meaning UI isn't in a typical sending state)
            throw new Error("ChatGPT submission failed. Input not cleared after all attempts and no send button indicates processing.");
          }
        } else if (finalTextInBox !== question.trim()) {
          // If text is different, assume submission worked or is in progress
          console.log("ChatGPT Interactor: Text in input box is different from original question. Assuming submission is okay.");
          submissionSuccessful = true;
        } else {
          // If question was empty and input is empty, or some other unhandled state
          console.log("ChatGPT Interactor: Assuming submission is okay by default if no explicit failure detected.");
          submissionSuccessful = true;
        }
      }

      // --- Step 4: Wait for a fixed 8 seconds then extract the response ---
      console.log("ChatGPT Interactor: Waiting 8 seconds for ChatGPT's response to generate...");
      await new Promise((r) => setTimeout(r, 10000));

      console.log("ChatGPT Interactor: Attempting to extract response after 8-second wait.");
      const turnSelector = "article[data-testid^='conversation-turn-']";
      const allTurns = Array.from(document.querySelectorAll(turnSelector));
      let lastValidResponseText = "";

      if (allTurns.length > 0) {
        const latestTurnElement = allTurns[allTurns.length - 1]; // Get the very last turn
        const assistantMessageContainer = latestTurnElement.querySelector("div[data-message-author-role='assistant']");

        if (assistantMessageContainer) {
          const markdownDiv = assistantMessageContainer.querySelector("div.markdown");
          if (markdownDiv) {
            let extractedText = "";
            const paragraphs = markdownDiv.querySelectorAll("p");
            if (paragraphs.length > 0) {
              paragraphs.forEach((p) => (extractedText += p.innerText.trim() + "\n"));
            } else {
              extractedText = markdownDiv.innerText.trim(); // Fallback if no <p> tags
            }
            lastValidResponseText = extractedText.trim();
            console.log("ChatGPT Interactor: Extracted response text:", lastValidResponseText);
          } else {
            console.warn("ChatGPT Interactor: Assistant message container found, but 'div.markdown' not found within it after wait.");
          }
        } else {
          console.warn("ChatGPT Interactor: No assistant message container found in the latest turn after wait.");
        }
      } else {
        console.warn("ChatGPT Interactor: No conversation turns found on the page after wait.");
      }

      if (!lastValidResponseText) {
        // Try to find any assistant message on the page as a last resort
        const anyAssistantMessage = document.querySelector("div[data-message-author-role='assistant'] div.markdown");
        if (anyAssistantMessage) {
          console.warn("ChatGPT Interactor: No specific last turn, trying any assistant message.");
          let extractedText = "";
          const paragraphs = anyAssistantMessage.querySelectorAll("p");
          if (paragraphs.length > 0) {
            paragraphs.forEach((p) => (extractedText += p.innerText.trim() + "\n"));
          } else {
            extractedText = anyAssistantMessage.innerText.trim();
          }
          lastValidResponseText = extractedText.trim();
          console.log("ChatGPT Interactor: Extracted from any assistant message:", lastValidResponseText);
        }
      }

      if (!lastValidResponseText) {
        console.warn("ChatGPT Interactor: Response text is empty after 8-second wait and fallbacks.");
      }

      console.log("ChatGPT Interactor: Final response to send back (after 8s wait):", lastValidResponseText);
      resolve(lastValidResponseText);
    } catch (err) {
      console.error("ChatGPT Interactor: Error in submitQuestionToChatGPT:", err);
      reject(err.message || "An unknown error occurred during ChatGPT interaction.");
    }
  });
}

function waitForElement(selector, timeout = 5000) {
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
        resolve(null);
      }
    }, intervalTime);
  });
}

console.log("ChatGPT Interactor: Event listeners set up.");
