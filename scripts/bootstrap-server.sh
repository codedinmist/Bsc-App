#!/usr/bin/env bash
# !! WARNING: this changes firewall/SSH/Node server-wide. Use it ONLY on a brand-new empty server. On a server with other apps, use bootstrap-safe.sh.
# JanSetu one-shot server setup for a fresh Ubuntu 22.04/24.04 VPS. Run ONCE as root:
#   bash bootstrap-server.sh
# It: creates user "jansetu", adds swap, firewall, fail2ban, auto-updates, Node 22, Docker, Java 17,
# Android SDK, tmux, Foundry, Slither, Claude Code. It disables SSH password login ONLY if an SSH key is present.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
USER_NAME=jansetu

echo "== 1/9 packages"
apt-get update -y && apt-get upgrade -y
apt-get install -y ufw fail2ban unattended-upgrades git build-essential curl unzip zip tmux jq pipx openjdk-17-jdk python3-pip ca-certificates gnupg

echo "== 2/9 user"
id "$USER_NAME" &>/dev/null || adduser --disabled-password --gecos "" "$USER_NAME"
usermod -aG sudo "$USER_NAME"
echo "$USER_NAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-$USER_NAME && chmod 440 /etc/sudoers.d/90-$USER_NAME
mkdir -p /home/$USER_NAME/.ssh
if [ -s /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys /home/$USER_NAME/.ssh/authorized_keys
  HAVE_KEY=1
else
  HAVE_KEY=0
fi
chown -R $USER_NAME:$USER_NAME /home/$USER_NAME/.ssh && chmod 700 /home/$USER_NAME/.ssh && chmod 600 /home/$USER_NAME/.ssh/authorized_keys 2>/dev/null || true

echo "== 3/9 swap (Android builds need memory)"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 4/9 firewall + fail2ban + auto updates"
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80,443/tcp
ufw --force enable
systemctl enable --now fail2ban
echo 'APT::Periodic::Update-Package-Lists "1"; APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades

echo "== 5/9 SSH hardening"
if [ "$HAVE_KEY" = 1 ]; then
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl restart ssh || systemctl restart sshd
  echo "Root login and passwords are now DISABLED. Log in as $USER_NAME with your key."
else
  echo "!! No SSH key found in /root/.ssh/authorized_keys, so password login stays ON."
  echo "!! Add your key to /home/$USER_NAME/.ssh/authorized_keys, test login, then re-run this script."
fi

echo "== 6/9 Node 22 + Docker"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
curl -fsSL https://get.docker.com | sh && usermod -aG docker $USER_NAME

echo "== 7/9 Android SDK"
SDK=/home/$USER_NAME/android-sdk
sudo -u $USER_NAME bash -lc "
  set -e
  mkdir -p $SDK/cmdline-tools && cd /tmp
  curl -fsSLo cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -qo cmdtools.zip -d $SDK/cmdline-tools && rm -rf $SDK/cmdline-tools/latest && mv $SDK/cmdline-tools/cmdline-tools $SDK/cmdline-tools/latest
  yes | $SDK/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null
  $SDK/cmdline-tools/latest/bin/sdkmanager 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'
"
cat >> /home/$USER_NAME/.bashrc <<RC
export ANDROID_HOME=$SDK
export PATH=\$PATH:\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$HOME/.foundry/bin:\$HOME/.local/bin
RC

echo "== 8/9 Foundry + Slither"
sudo -u $USER_NAME bash -lc "
  curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup
  pipx install slither-analyzer && pipx install solc-select && ~/.local/bin/solc-select install 0.8.28 && ~/.local/bin/solc-select use 0.8.28
"

echo "== 9/9 Claude Code"
npm install -g @anthropic-ai/claude-code

echo
echo "DONE. Next: log out, then log in as $USER_NAME, run:  tmux new -s jansetu   then   claude"
