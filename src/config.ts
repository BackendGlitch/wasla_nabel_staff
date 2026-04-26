// Station server on LAN
const host = "192.168.1.10";
const httpProtocol = "http";
const wsProtocol = "ws";

export const API = {
  auth: `${httpProtocol}://${host}:8001`,
  queue: `${httpProtocol}://${host}:8002`,
  booking: `${httpProtocol}://${host}:8003`,
  ws: `${wsProtocol}://${host}:8004`,
  printer: `${httpProtocol}://${host}:8005`,
};