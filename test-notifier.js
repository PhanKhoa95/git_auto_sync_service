const { showNotification } = require('./src/notifier');
console.log('Sending notification...');
showNotification('Test Notification JS', 'If you see this, notifications are working from Node!');
console.log('Notification sent. Waiting 2 seconds...');
setTimeout(() => {
  console.log('Done.');
}, 2000);
