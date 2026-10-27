const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;

createApp().listen(PORT, () => {
  console.log(`Ledger API running at http://localhost:${PORT}`);
});
