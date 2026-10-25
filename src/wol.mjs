import { createSocket } from "node:dgram";

export function wakePacket(mac) {
  const hex = String(mac).replaceAll(":", "").replaceAll("-", "");
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) throw new Error("Ungültige Wake-on-LAN-Adresse.");
  const address = Buffer.from(hex, "hex");
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => address)]);
}

export function sendWakeOnLan(mac, broadcast = "10.222.0.255", port = 9) {
  const packet = wakePacket(mac);
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    socket.once("error", error => { socket.close(); reject(error); });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, port, broadcast, error => {
        socket.close();
        if (error) reject(error);
        else resolve();
      });
    });
  });
}
