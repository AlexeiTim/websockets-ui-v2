import { SEND_EVENTS } from "./index.js";
import { DATA_BASE } from "../db.js";
import {
  addWinForUser,
  generateRoom,
  generateShipCells,
  getBotShipsVariant,
  getCoordsAroundShip,
  getRandomCoordsByHistory,
  sendError,
  sendMessage,
} from "../helpers.js";
import {
  AttackData,
  FinishData,
  GameInfo,
  RegData,
  Ship,
  ShipWithCells,
  TurnData,
  WebSocketWithPlayerId,
} from "../types.js";
import { updateRoom, updateWinners } from "./send.js";

export function singlePlay(data: string, ws: WebSocketWithPlayerId): void {
  const currentUser = DATA_BASE.usersMap.get(ws.playerId);
  if (!currentUser) return;

  const createdRoom = generateRoom({
    name: "BOT",
    id: "BOT",
  });
  addUserRoRoom(
    JSON.stringify({
      indexRoom: createdRoom.roomId,
    }),
    ws
  );
  DATA_BASE.roomsMap.delete(createdRoom.roomId);
  const actualGame = Array.from(DATA_BASE.gamesMap).find(
    ([gameId, gameInfo]) => {
      return gameInfo.roomUsers.some(
        (roomUser) =>
          roomUser.index === "BOT" || roomUser.index === currentUser.id
      );
    }
  );
  if (!actualGame) return;

  const generatedShips = getBotShipsVariant();
  addShips(
    JSON.stringify({
      gameId: actualGame[0],
      ships: generatedShips,
      indexPlayer: "BOT",
    })
  );
}

export function addUserRoRoom(data: string, ws: WebSocketWithPlayerId): void {
  const currentUser = DATA_BASE.usersMap.get(ws.playerId);
  if (!currentUser) return;

  const body = JSON.parse(data);
  const addedRoomId = body.indexRoom;
  const room = DATA_BASE.roomsMap.get(addedRoomId);
  if (!room) {
    sendError("Not found room", ws);
    return;
  }
  if (room.roomUsers.some((user) => user.index === currentUser.id)) {
    sendMessage("User with this id already in room", ws);
    return;
  }

  room.roomUsers.push({
    name: currentUser.name,
    index: currentUser.id,
  });
  room.available = false;
  DATA_BASE.roomsMap.set(addedRoomId, room);
  SEND_EVENTS.create_game(addedRoomId, ws);
  SEND_EVENTS.update_room();
}

export function addShips(data: string): void {
  const body = JSON.parse(data);
  const { gameId, ships, indexPlayer } = body;
  const game = DATA_BASE.gamesMap.get(gameId);
  if (!game) return;

  const playerInfo: GameInfo = {
    indexPlayer,
    ships,
    shipsWithCells: ships.map((ship: Ship) => {
      const direction = ship.direction ? "vertical" : "horizontal";
      const newShip: ShipWithCells = {
        state: "live",
        direction,
        type: ship.type,
        cells: [],
        length: ship.length,
      };
      if (ship.type === "small") {
        newShip.cells.push({
          x: ship.position.x,
          y: ship.position.y,
          state: "live",
        });
        return newShip;
      }
      newShip.cells.push(...generateShipCells(ship));
      return newShip;
    }),
    shotsHistory: [],
  };
  if (game.info && game.info.length) {
    game.info.push(playerInfo);
    SEND_EVENTS.start_game(gameId);
  } else {
    game.info = [playerInfo];
  }
}

export function reg(data: string, ws: WebSocketWithPlayerId): void {
  const id = Date.now();
  const parsedData = JSON.parse(data);
  const hasUser = Array.from(DATA_BASE.usersMap).find(
    ([_, user]) => user.name === parsedData.name
  );
  if (hasUser) {
    sendError("User exists", ws);
    return;
  }
  DATA_BASE.usersMap.set(id, {
    id,
    ...parsedData,
    wins: 0,
  });
  const requestData: RegData = {
    name: parsedData.name,
    index: id,
    error: false,
    errorText: "",
  };

  console.log("send reg???");
  SEND_EVENTS.reg(requestData, ws);
  SEND_EVENTS.update_room();
  SEND_EVENTS.update_winners();
  ws.playerId = id;
  DATA_BASE.socketsMap.set(id, ws);
}

export function attack(data: string): void {
  const body = JSON.parse(data);
  const { gameId, x, y, indexPlayer } = body;
  const game = DATA_BASE.gamesMap.get(gameId);
  if (!game || !game.info) return;

  const currentTurn = game.turn;
  if (currentTurn !== indexPlayer) {
    const socket = DATA_BASE.socketsMap.get(indexPlayer);
    if (socket) {
      sendMessage("Wait turn other player", socket);
    }
    return;
  }

  const enemyInfo = game.info.find((i) => i.indexPlayer !== indexPlayer);
  if (!enemyInfo) return;

  const hasAttackCoords = enemyInfo.shotsHistory.find(
    (item) => item.x === x && item.y === y
  );
  if (hasAttackCoords) {
    const socket = DATA_BASE.socketsMap.get(indexPlayer);
    if (socket) {
      sendMessage("Already shoted", socket);
    }
    return;
  }
  enemyInfo.shotsHistory.push({ x, y });
  const findedShipWithCells = enemyInfo.shipsWithCells.find((shipWithCells) =>
    shipWithCells.cells.some((cell) => cell.x === x && cell.y === y)
  );
  if (!findedShipWithCells) {
    const otherPlayerIndex = game.info.find(
      (i) => i.indexPlayer !== indexPlayer
    )?.indexPlayer;
    if (!otherPlayerIndex) return;

    game.turn = otherPlayerIndex;

    game.info.forEach((info) => {
      const socket = DATA_BASE.socketsMap.get(info.indexPlayer);
      if (!socket) return;

      const attackData: AttackData = {
        position: { x, y },
        currentPlayer: indexPlayer,
        status: "miss",
      };
      sendMessage(
        JSON.stringify({
          type: "attack",
          data: JSON.stringify(attackData),
          id: 0,
        }),
        socket
      );

      const turnData: TurnData = {
        currentPlayer: otherPlayerIndex,
      };

      sendMessage(
        JSON.stringify({
          type: "turn",
          data: JSON.stringify(turnData),
          id: 0,
        }),
        socket
      );
    });
    DATA_BASE.gamesMap.set(gameId, game);
    if (game.turn === "BOT") {
      randomAttack(
        JSON.stringify({
          gameId,
          indexPlayer: "BOT",
        })
      );
    }
  } else {
    findedShipWithCells.cells = findedShipWithCells.cells.map((cell) => {
      if (cell.x === x && cell.y === y && cell.state === "live") {
        return {
          ...cell,
          state: "shot",
        };
      } else {
        return cell;
      }
    });
    const isKilled = findedShipWithCells.cells.every(
      (cell) => cell.state === "shot"
    );
    let requestStatus: "shot" | "kill" = "shot";
    if (isKilled) {
      requestStatus = "kill";
      findedShipWithCells.state = "kill";
    }
    enemyInfo.shipsWithCells = enemyInfo.shipsWithCells.map((ship) =>
      ship === findedShipWithCells ? findedShipWithCells : ship
    );
    game.info = game.info.map((i) => {
      if (i.indexPlayer === indexPlayer) {
        return i;
      } else {
        return enemyInfo;
      }
    });
    DATA_BASE.gamesMap.set(gameId, game);
    const isGameFinished = enemyInfo.shipsWithCells.every(
      (ship) => ship.state === "kill"
    );
    game.info.forEach((info) => {
      const socket = DATA_BASE.socketsMap.get(info.indexPlayer);
      if (!socket) return;

      const coordsAroundKilledShip = getCoordsAroundShip(findedShipWithCells);
      if (isKilled) {
        coordsAroundKilledShip.forEach((coord) => {
          const attackData: AttackData = {
            position: { x: coord.x, y: coord.y },
            currentPlayer: indexPlayer,
            status: coord.state as AttackData["status"],
          };
          sendMessage(
            JSON.stringify({
              type: "attack",
              data: JSON.stringify(attackData),
              id: 0,
            }),
            socket
          );
        });
      } else {
        const attackData: AttackData = {
          position: { x, y },
          currentPlayer: indexPlayer,
          status: requestStatus,
        };
        sendMessage(
          JSON.stringify({
            type: "attack",
            data: JSON.stringify(attackData),
            id: 0,
          }),
          socket
        );
      }

      const turnData: TurnData = {
        currentPlayer: indexPlayer,
      };

      sendMessage(
        JSON.stringify({
          type: "turn",
          data: JSON.stringify(turnData),
          id: 0,
        }),
        socket
      );
      if (isGameFinished) {
        const finishData: FinishData = {
          winPlayer: indexPlayer,
        };

        sendMessage(
          JSON.stringify({
            type: "finish",
            data: JSON.stringify(finishData),
            id: 0,
          }),
          socket
        );
      }
    });
    if (isGameFinished) {
      const isGameWithBot = game.info.some((i) => i.indexPlayer === "BOT");
      if (!isGameWithBot && typeof indexPlayer === "number") {
        addWinForUser(indexPlayer);
      }
      DATA_BASE.gamesMap.delete(gameId);
      updateWinners();
      updateRoom();
    }
    if (game.turn === "BOT") {
      randomAttack(
        JSON.stringify({
          gameId,
          indexPlayer: "BOT",
        })
      );
    }
  }
}

export function randomAttack(data: string): void {
  const { gameId, indexPlayer } = JSON.parse(data);

  const game = DATA_BASE.gamesMap.get(gameId);
  if (!game || !game.info) return;

  const enemyInfo = game.info.find((i) => i.indexPlayer !== indexPlayer);
  if (!enemyInfo) return;

  const shotsHistory = enemyInfo.shotsHistory;
  let { x, y } = getRandomCoordsByHistory(shotsHistory);

  attack(
    JSON.stringify({
      gameId,
      x,
      y,
      indexPlayer,
    })
  );
}
