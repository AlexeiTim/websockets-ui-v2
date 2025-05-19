import { DATA_BASE } from "../db.js";
import {
  findSocketByUserId,
  generateRoom,
  getWinners,
  sendAllMessage,
  sendError,
  sendMessage,
} from "../helpers.js";
import {
  CreateGameData,
  RegData,
  StartGameData,
  TurnData,
  WebSocketWithPlayerId,
} from "../types.js";
import { addUserRoRoom, randomAttack } from "./incoming.js";

export function sendReg(data: RegData, ws: WebSocketWithPlayerId): void {
  console.log("send message");
  sendMessage(
    JSON.stringify({
      type: "reg",
      data: JSON.stringify(data),
      id: 0,
    }),
    ws
  );
}

export function updateWinners(): void {
  const winners = getWinners();
  sendAllMessage(
    JSON.stringify({
      type: "update_winners",
      data: JSON.stringify(winners),
      id: 0,
    })
  );
}

export function createRoom(data: string, ws: WebSocketWithPlayerId): void {
  const user = DATA_BASE.usersMap.get(ws.playerId);
  if (!user) return;

  const createRoomData = generateRoom(user);
  addUserRoRoom(
    JSON.stringify({
      indexRoom: createRoomData.roomId,
    }),
    ws
  );
}

export function updateRoom(): void {
  const roomsArr = Array.from(DATA_BASE.roomsMap);
  const games = Array.from(DATA_BASE.gamesMap);

  const rooms = roomsArr
    .map((room) => room[1])
    .filter((room) => {
      const allUsersInGame = room.roomUsers.length === 2;
      if (allUsersInGame) {
        return false;
      }
      const gameWithSomePlayer = games.find(([gameId, gameInfo]) => {
        const gameUsersIndexes = gameInfo.roomUsers.map((user) => user.index);
        const hasUserIndexInRoom = room.roomUsers.some((user) =>
          gameUsersIndexes.some((gameUserIdx) => gameUserIdx === user.index)
        );
        if (hasUserIndexInRoom) return true;
      });
      if (gameWithSomePlayer) return false;

      return true;
    });

  sendAllMessage(
    JSON.stringify({
      type: "update_room",
      data: JSON.stringify(rooms),
      id: 0,
    })
  );
}

export function startGame(gameId: number): void {
  const game = DATA_BASE.gamesMap.get(gameId);
  if (!game || !game.info) return;

  const initTurnPlayer = game.info[0].indexPlayer;
  game.turn = initTurnPlayer;
  game.info.forEach((info) => {
    const socket = DATA_BASE.socketsMap.get(info.indexPlayer);
    if (!socket) return;

    const startGameData: StartGameData = {
      ships: info.ships,
      currentPlayerIndex: info.indexPlayer,
    };

    sendMessage(
      JSON.stringify({
        type: "start_game",
        data: JSON.stringify(startGameData),
        id: 0,
      }),
      socket
    );

    const turnData: TurnData = {
      currentPlayer: initTurnPlayer,
    };

    sendMessage(
      JSON.stringify({
        type: "turn",
        data: JSON.stringify(turnData),
        id: 0,
      }),
      socket
    );
    if (
      game.info?.some((i) => i.indexPlayer === "BOT") &&
      game.turn === "BOT"
    ) {
      randomAttack(
        JSON.stringify({
          gameId,
          indexPlayer: "BOT",
        })
      );
    }
  });
  DATA_BASE.gamesMap.set(gameId, game);
}

export function createGame(roomId: string, ws: WebSocketWithPlayerId): void {
  const room = DATA_BASE.roomsMap.get(roomId);
  if (!room) {
    sendError("Room not found", ws);
    return;
  }
  if (room.roomUsers.length < 2) {
    sendError("Need 2 users for game", ws);
    return;
  }
  const gameId = Date.now();
  DATA_BASE.gamesMap.set(gameId, {
    roomUsers: room.roomUsers,
  });
  room.roomUsers.forEach((user) => {
    const socket = findSocketByUserId(user.index);
    if (!socket) return;

    const createGameData: CreateGameData = {
      idGame: gameId,
      idPlayer: user.index,
    };

    sendMessage(
      JSON.stringify({
        type: "create_game",
        data: JSON.stringify(createGameData),
        id: 0,
      }),
      socket
    );
  });
  DATA_BASE.roomsMap.delete(roomId);
}
