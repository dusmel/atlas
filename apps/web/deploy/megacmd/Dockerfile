# MEGA's own headless client, from its signed apt repo. It keeps a login session, so 2FA is entered once.
FROM ubuntu:24.04
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && curl -fsSL https://mega.nz/linux/repo/xUbuntu_24.04/Release.key | gpg --dearmor -o /usr/share/keyrings/mega.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/mega.gpg] https://mega.nz/linux/repo/xUbuntu_24.04/ ./" > /etc/apt/sources.list.d/mega.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends megacmd \
 && rm -rf /var/lib/apt/lists/*
# The session and sync settings live in $HOME/.megaCmd, a bind mount on the box.
ENV HOME=/config
CMD ["mega-cmd-server"]
