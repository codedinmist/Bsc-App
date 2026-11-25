#!/usr/bin/env bash
# JANSETU "safe" setup for a server that ALREADY runs other things.
# Run as root:  bash bootstrap-safe.sh [--swap] [--android]
#   --swap     adds a 2 GB swap file (use if the server has no swap)
#   --android  also installs Java + Android SDK (needs ~20 GB free disk and 6 GB+ RAM). Default: skipped.
# It does NOT: touch the firewall, SSH settings, existing users/files, system Node/Java, Docker, or upgrade packages.
# It DOES: create user "jansetu" (no sudo), install a few small missing packages, and put Node, Java, Android SDK,
# Foundry, Slither and Claude Code inside /home/jansetu only. 
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
U=jansetu
SWAP=0; ANDROID=0
for a in "$@"; do case "$a" in --swap) SWAP=1;; --android) ANDROID=1;; esac; done

echo "== Current state (read-only) =="
echo "RAM:"; free -h | sed -n '1,2p'; echo "Disk:"; df -h / | tail -1
echo "Listening ports (don't clash with these):"; ss -tlnH | awk '{print $4}' | sort -u | head -30
command -v docker >/dev/null && echo "Docker: present (will be left alone)" || echo "Docker: not installed (not needed until the database phase)"
echo
FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
NEED=8; [ "$ANDROID" = 1 ] && NEED=25
[ "$FREE_GB" -ge "$NEED" ] || { echo "Need at least ${NEED} GB free disk, have ${FREE_GB} GB. Stop."; exit 1; }
echo "Mode: android=$ANDROID swap=$SWAP (needs ${NEED} GB free, have ${FREE_GB} GB)"
read -r -p "Continue? Make sure you have a VPS snapshot/backup first. [y/N] " ok; [ "$ok" = y ] || exit 0

echo "== small packages (install only, no upgrades)"
apt-get update -y
apt-get install -y --no-install-recommends tmux git unzip zip jq curl ca-certificates build-essential python3-pip pipx

echo "== user (no sudo, no password)"
id "$U" &>/dev/null || adduser --disabled-password --gecos "" "$U"
mkdir -p /home/$U/.ssh && chmod 700 /home/$U/.ssh
[ -s /root/.ssh/authorized_keys ] && [ ! -s /home/$U/.ssh/authorized_keys ] && cp /root/.ssh/authorized_keys /home/$U/.ssh/authorized_keys
chown -R $U:$U /home/$U/.ssh; chmod 600 /home/$U/.ssh/authorized_keys 2>/dev/null || true

if [ "$SWAP" = 1 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== user-level tools (inside /home/$U only)"
sudo -u $U bash -lc '
  set -e
  curl -fsSo- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  nvm install 22 && nvm alias default 22
  npm install -g @anthropic-ai/claude-code

  if [ "'$ANDROID'" = 1 ]; then
  # Java 17 (private copy, does not change the system java)
    mkdir -p ~/jdk && cd /tmp
    curl -fsSL -o jdk17.tgz "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
    tar -xzf jdk17.tgz -C ~/jdk --strip-components=1

    # Android SDK
    SDK=$HOME/android-sdk; mkdir -p $SDK/cmdline-tools
    curl -fsSLo cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
    unzip -qo cmdtools.zip -d $SDK/cmdline-tools && rm -rf $SDK/cmdline-tools/latest && mv $SDK/cmdline-tools/cmdline-tools $SDK/cmdline-tools/latest
    export JAVA_HOME=$HOME/jdk
    yes | $SDK/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null
    $SDK/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
  fi

  # Foundry + Slither
  curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup
  pipx install slither-analyzer && pipx install solc-select
  ~/.local/bin/solc-select install 0.8.28 && ~/.local/bin/solc-select use 0.8.28

  # Keep Gradle polite so it cannot starve your other apps
  mkdir -p ~/.gradle && printf "org.gradle.jvmargs=-Xmx2g\norg.gradle.workers.max=2\norg.gradle.daemon=false\n" > ~/.gradle/gradle.properties
'
cat >> /home/$U/.bashrc <<'RC'
export JAVA_HOME=$HOME/jdk
export ANDROID_HOME=$HOME/android-sdk
export PATH=$JAVA_HOME/bin:$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$HOME/.foundry/bin:$HOME/.local/bin
RC
chown $U:$U /home/$U/.bashrc
echo
echo "DONE. Nothing else on this server was changed."
echo "Next: log in as $U (or: su - $U), then:  tmux new -s jansetu   then   claude"
echo "Build the APK only when the server is quiet, using:  nice -n 19 ./gradlew assembleRelease"
