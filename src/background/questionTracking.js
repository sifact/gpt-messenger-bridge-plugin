// Track processed questions to avoid duplicates
let processedQuestions = new Map();

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

export { hashString, trackProcessedQuestion, isQuestionAlreadyProcessed };
