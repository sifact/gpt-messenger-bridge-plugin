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

export { waitForElementOnPage, NEXT_BUTTON_STYLES };
