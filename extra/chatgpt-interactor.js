// chatgpt-interactor.js
console.log("ChatGPT Interactor content script loaded.");

let lastProcessedQuestion = "";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "askQuestion") {
    console.log("ChatGPT Interactor: Received question:", request.question);
    if (request.question === lastProcessedQuestion && Date.now() - lastProcessTime < 5000) {
      console.warn("ChatGPT Interactor: Question is the same as last processed very recently. Skipping.");
      sendResponse({ status: "skipped_recent_duplicate" });
      return true;
    }
    lastProcessedQuestion = request.question;
    lastProcessTime = Date.now();

    submitQuestionToChatGPT(request.question)
      .then((answer) => {
        console.log("ChatGPT Interactor: Sending answer back to background:", answer);
        chrome.runtime.sendMessage({ action: "chatGPTResponse", answer: answer });
      })
      .catch((error) => {
        console.error("ChatGPT Interactor: Error processing question:", error);
        chrome.runtime.sendMessage({ action: "chatGPTResponse", error: error.toString() });
      });
    sendResponse({ status: "processing" });
    return true;
  }
});

let lastProcessTime = 0;

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

      // --- Step 2: Set the question text with detailed logging ---
      console.log("ChatGPT Interactor: Focusing input field...", inputField);
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
        console.log("ChatGPT Interactor: inputField.innerHTML AFTER direct set:", inputField.innerHTML);

        console.log("ChatGPT Interactor: Dispatching 'input' event.");
        inputField.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        console.log("ChatGPT Interactor: inputField.innerHTML AFTER 'input' event:", inputField.innerHTML);

        // The 'change' event is less standard for contenteditable but kept for now.
        console.log("ChatGPT Interactor: Dispatching 'change' event.");
        inputField.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        console.log("ChatGPT Interactor: inputField.innerHTML AFTER 'change' event:", inputField.innerHTML);
      } else if (inputField.tagName === "TEXTAREA") {
        console.log("ChatGPT Interactor: Setting value for TEXTAREA.");
        inputField.value = question;
        console.log("ChatGPT Interactor: inputField.value AFTER direct set:", inputField.value);
        inputField.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        console.log("ChatGPT Interactor: inputField.value AFTER 'input' event:", inputField.value);
      } else {
        // Fallback for other types
        console.log("ChatGPT Interactor: Setting textContent for other input type.");
        inputField.textContent = question;
        inputField.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      }

      // Re-focus just in case, and final log of what the DOM sees as text content
      inputField.focus();
      console.log("ChatGPT Interactor: Final inputField.textContent after all setting attempts:", inputField.textContent);
      console.log("ChatGPT Interactor: Final inputField.innerHTML after all setting attempts:", inputField.innerHTML);

      // Verify text content
      // For ProseMirror, the actual text might be in child <p> tags.
      // We need to ensure the visible text matches the question.
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
        // Optional: throw an error here if this is critical
        // reject(new Error("Failed to reliably set text in ChatGPT input field."));
        // return; // Stop further execution if text isn't set.
      } else {
        console.log("ChatGPT Interactor: Text successfully set and verified in input field.");
      }

      // Wait a bit longer for the UI to react, especially for the send button to enable
      await new Promise((r) => setTimeout(r, 300));

      console.log("ChatGPT Interactor: Proceeding to attempt submission.");

      // --- Step 3: Attempt to submit using the specific button first ---
      const specificSendButtonSelector = "button#composer-submit-button[data-testid='send-button']";
      let sendButton = document.querySelector(specificSendButtonSelector);

      if (sendButton && !sendButton.disabled) {
        console.log("ChatGPT Interactor: Specific send button (composer-submit-button) found and enabled. Clicking it.", sendButton);
        sendButton.click();
      } else {
        if (sendButton && sendButton.disabled) {
          console.log("ChatGPT Interactor: Specific send button (composer-submit-button) found but is DISABLED. Will try Enter key.");
        } else {
          console.log("ChatGPT Interactor: Specific send button (composer-submit-button) NOT FOUND. Will try Enter key.");
        }

        console.log("ChatGPT Interactor: Simulating Enter key press.");
        inputField.focus(); // Ensure focus
        inputField.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));

        await new Promise((r) => setTimeout(r, 500)); // Wait for submission to process

        const currentInputValue = inputField.isContentEditable ? inputField.textContent.trim() : inputField.value.trim();
        // Check if input field still contains the question or if it was appended (ProseMirror might append <p><br></p>)
        if (currentInputValue === question.trim() || (inputField.isContentEditable && inputField.innerHTML.includes(question.replace(/\n/g, "</p><p>")))) {
          console.warn("ChatGPT Interactor: Input field still contains the question after Enter simulation. Submission might have failed.");
          sendButton = document.querySelector(specificSendButtonSelector);
          if (sendButton && !sendButton.disabled) {
            console.log("ChatGPT Interactor: Retrying click on specific send button as Enter might have failed.", sendButton);
            sendButton.click();
          } else {
            throw new Error("ChatGPT submission failed. Input not cleared after Enter and specific send button is not available/enabled.");
          }
        }
      }
      console.log("ChatGPT Interactor: Question submission attempted.");

      // --- Step 4: Wait for and extract the response ---
      console.log("ChatGPT Interactor: Waiting for ChatGPT's response to appear...");
      // Updated selector based on provided HTML for conversation turns
      const turnSelector = "article[data-testid^='conversation-turn-']";
      // Specific selector for the assistant's message text container
      const assistantMessageTextSelector = "div[data-message-author-role='assistant'] div.markdown";

      let lastValidResponseText = "";
      const startTime = Date.now();
      let initialTurnCount = document.querySelectorAll(turnSelector).length;
      console.log(`ChatGPT Interactor: Initial turn count on page: ${initialTurnCount}`);

      while (Date.now() - startTime < 60000) {
        // Max 60 seconds wait
        const allTurns = Array.from(document.querySelectorAll(turnSelector));

        if (allTurns.length > initialTurnCount) {
          // A new turn has appeared
          const latestTurnElement = allTurns[allTurns.length - 1];

          // Check if this latest turn is from the assistant
          const assistantMessageContainer = latestTurnElement.querySelector("div[data-message-author-role='assistant']");

          if (assistantMessageContainer) {
            console.log("ChatGPT Interactor: Found a new turn from assistant.", latestTurnElement);

            // Check for "stop generating" button to know if response is still streaming
            const stopGeneratingButton = latestTurnElement.querySelector("button[aria-label*='Stop generating'], button[data-testid*='stop-generating']");
            const regenButton = latestTurnElement.querySelector("button[aria-label*='Regenerate'], button[data-testid*='regenerate']");

            if (!stopGeneratingButton || regenButton) {
              // If no stop button, or regen button is present, assume generation is complete or nearly complete
              console.log("ChatGPT Interactor: Response generation appears complete (no stop button or regen button found).");

              // Extract text from the markdown div
              const markdownDiv = assistantMessageContainer.querySelector("div.markdown");
              if (markdownDiv) {
                let extractedText = "";
                // The text is often in <p> tags within the markdown div
                const paragraphs = markdownDiv.querySelectorAll("p");
                if (paragraphs.length > 0) {
                  paragraphs.forEach((p) => (extractedText += p.innerText.trim() + "\n"));
                } else {
                  // Fallback if no <p> tags, try direct innerText of markdown div
                  extractedText = markdownDiv.innerText.trim();
                }

                if (extractedText.trim()) {
                  lastValidResponseText = extractedText.trim();
                  console.log("ChatGPT Interactor: Extracted final response text:", lastValidResponseText);
                  break; // Exit loop once a valid response is extracted
                } else {
                  console.log("ChatGPT Interactor: Markdown div found, but extracted text is empty. Waiting for content...");
                }
              } else {
                console.log("ChatGPT Interactor: Assistant message container found, but 'div.markdown' not found within it. Structure might have changed.");
              }
            } else {
              console.log("ChatGPT Interactor: Response is still generating (stop button found). Waiting...");
            }
          }
        }
        await new Promise((r) => setTimeout(r, 1000)); // Check every 1 second
      }

      if (!lastValidResponseText) {
        // Check one last time without the streaming assumption if timeout occurred
        const allTurnsFinal = Array.from(document.querySelectorAll(turnSelector));
        if (allTurnsFinal.length > initialTurnCount) {
          const latestTurnElementFinal = allTurnsFinal[allTurnsFinal.length - 1];
          const assistantMessageContainerFinal = latestTurnElementFinal.querySelector("div[data-message-author-role='assistant']");
          if (assistantMessageContainerFinal) {
            const markdownDivFinal = assistantMessageContainerFinal.querySelector("div.markdown");
            if (markdownDivFinal) {
              let extractedTextFinal = "";
              const paragraphsFinal = markdownDivFinal.querySelectorAll("p");
              if (paragraphsFinal.length > 0) {
                paragraphsFinal.forEach((p) => (extractedTextFinal += p.innerText.trim() + "\n"));
              } else {
                extractedTextFinal = markdownDivFinal.innerText.trim();
              }
              if (extractedTextFinal.trim()) {
                lastValidResponseText = extractedTextFinal.trim();
                console.log("ChatGPT Interactor: Extracted response text on final check:", lastValidResponseText);
              }
            }
          }
        }
      }

      if (!lastValidResponseText) {
        throw new Error("ChatGPT response text did not appear or complete in time, or could not be extracted.");
      }

      console.log("ChatGPT Interactor: Final response to send back:", lastValidResponseText);
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
