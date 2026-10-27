# Ledger API - one-shot setup for a fresh Ubuntu EC2 server.
# Paste into the EC2 Instance Connect terminal. Safe to run again to update.
set -e
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential
if [ -d ~/ledger-api/.git ]; then
  cd ~/ledger-api && git fetch && git reset --hard origin/main
else
  git clone https://github.com/hr7657316/Ledger-Api.git ~/ledger-api && cd ~/ledger-api
fi
npm ci --omit=dev
sudo npm install -g pm2
pm2 delete ledger 2>/dev/null || true
pm2 start src/server.js --name ledger
pm2 save
sudo env PATH=$PATH $(which pm2) startup systemd -u $USER --hp $HOME
echo "DONE -> test with: curl http://localhost:3000/health"
