import { IncomingMessage } from "../types.js";
import { DATA_BASE } from "../db.js";
import { WebSocketWithPlayerId } from "../types.js";
import { updateRoom, updateWinners } from "./send.js";
import { INCOMING_EVENTS } from "./index.js";

export const disconnect = (ws: WebSocketWithPlayerId) => {
  console.log("ws disconnect");
  if (ws.playerId) {
    console.log("reg user disconnected with id: " + ws.playerId);
    DATA_BASE.usersMap.delete(ws.playerId);
    DATA_BASE.socketsMap.delete(ws.playerId);
    const rooms = Array.from(DATA_BASE.roomsMap);
    rooms.forEach(([roomId, roomData]) => {
      const hasDisconnectedUser = roomData.roomUsers.find(
        (room) => room.index === ws.playerId
      );
      if (hasDisconnectedUser) {
        DATA_BASE.roomsMap.delete(roomId);
      }
    });
    const games = Array.from(DATA_BASE.gamesMap);
    games.forEach(([gameId, gameInfo]) => {
      const hasUserInGame = gameInfo.roomUsers.find(
        (user) => user.index === ws.playerId
      );
      if (hasUserInGame) {
        DATA_BASE.gamesMap.delete(gameId);
      }
    });
    updateRoom();
    updateWinners();
  }
};

export const connection = (ws: WebSocketWithPlayerId) => {
  console.log("connection", ws);
  ws.on("error", console.error);

  ws.on("message", (data: string) => {
    const body: IncomingMessage = JSON.parse(data);
    console.log("Incoming message type: ", body.type);
    const handler = INCOMING_EVENTS[body.type as keyof typeof INCOMING_EVENTS];
    if (handler) {
      handler(body.data, ws);
    }
  });

  ws.on("close", disconnect);
};
