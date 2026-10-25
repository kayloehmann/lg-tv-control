const tv = "10.222.0.83";
const socket = new WebSocket(`ws://${tv}:3000`);

const timeout = setTimeout(() => {
  console.error("Timed out waiting for the TV");
  socket.close();
  process.exitCode = 1;
}, 30000);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    id: "register",
    type: "register",
    payload: {
      pairingType: "PROMPT",
      manifest: {
        manifestVersion: 1,
        appVersion: "1.0",
        signed: {
          appId: "dev.codex.lgroot",
          vendorId: "dev.codex",
          localizedAppNames: { "": "LG Root Setup" },
          localizedVendorNames: { "": "Kay" },
          permissions: ["LAUNCH", "READ_INSTALLED_APPS"]
        },
        permissions: ["LAUNCH", "READ_INSTALLED_APPS"]
      }
    }
  }));
});

socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  console.log(message.type, message.id ?? "", message.payload?.returnValue ?? "");
  if (message.type === "registered") {
    socket.send(JSON.stringify({
      id: "launch-homebrew",
      type: "request",
      uri: "ssap://system.launcher/launch",
      payload: { id: "org.webosbrew.hbchannel" }
    }));
  } else if (message.id === "launch-homebrew") {
    clearTimeout(timeout);
    socket.close();
  }
});

socket.addEventListener("error", (event) => {
  clearTimeout(timeout);
  console.error("WebSocket error", event.message ?? "");
  process.exitCode = 1;
});
