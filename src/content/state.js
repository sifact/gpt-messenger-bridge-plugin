const notFoundMessages = new Set();
let isAttemptingDelivery = false;
let currentResponseToDeliver = null;

const deliveryAttempts = {
  isAttemptingDelivery,
  currentResponseToDeliver,
};

export { notFoundMessages, deliveryAttempts };
