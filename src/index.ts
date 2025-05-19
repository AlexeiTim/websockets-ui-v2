import { WebSocketServer } from "ws";
import { httpServer } from "./http_server/index.js";
import { connection } from "./events/common.js";

export const wss = new WebSocketServer({
  port: 3000,
});

const HTTP_PORT = 8181;

console.log(`Start static http server on the ${HTTP_PORT} port!`);
httpServer.listen(HTTP_PORT);

wss.on("connection", connection);
